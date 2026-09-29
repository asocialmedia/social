import { and, fromPrismaDateTime, prisma, unreadMessageCache } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { MAX_HIDE_BATCH } from "@/lib/messages/message-delete";
import {
  getConversationForUser,
  isUniqueConstraintViolation,
  parseJsonBody,
} from "@/lib/messages/server";

// The cap keeps a single request's insert bounded (one batched create) so a
// malicious or buggy client cannot ask for an unbounded write. The client
// chunks a larger selection into batches of this size (see message-delete.ts).

// "Delete for me": hide one or more messages from this user only. The peer's
// copy is untouched, and because the hide is actor-scoped there is nothing to
// broadcast — the actor's own client removes the rows optimistically and every
// list/thread/badge query excludes them from then on via the shared
// `visibleToUser` / `unreadMessageWhere` filters.
//
// Batched on purpose: selecting a run of messages in the transcript is one
// request, not N. The body is validated against the conversation before any
// write so ids from another thread cannot be hidden through this route.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const body = (await parseJsonBody(request)) as {
    messageIds?: unknown;
  } | null;
  const rawIds = body?.messageIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return Response.json(
      { error: "messageIds must be a non-empty array" },
      { status: 400 }
    );
  }
  // Dedupe before the length check so a spammed duplicate list cannot trip the
  // cap, and drop non-string entries rather than coercing them. An all-invalid
  // list is rejected.
  const messageIds = [
    ...new Set(
      (rawIds as unknown[]).filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      )
    ),
  ];
  if (messageIds.length === 0 || messageIds.length > MAX_HIDE_BATCH) {
    return Response.json(
      { error: `messageIds must be 1 to ${MAX_HIDE_BATCH} ids` },
      { status: 400 }
    );
  }

  // Scope the ids to this conversation. An id from another thread resolves to
  // nothing here, so it is silently ignored rather than hidden.
  const rows = await prisma.orm.public.Messages.select(
    "createdAt",
    "deletedAt",
    "id",
    "senderId"
  )
    .where((message) =>
      and(message.conversationId.eq(id), message.id.in(messageIds))
    )
    .all();
  if (rows.length === 0) {
    return Response.json({ hidden: 0 });
  }

  // A hide is create-only and the badge credit must match the rows actually
  // inserted. A retried or double-submitted request would otherwise re-credit
  // the same unread messages and drift the Redis counter low until a reseed, so
  // drop the ids this user has already hidden before counting and inserting.
  const alreadyHidden = await prisma.orm.public.MessageHiddens.select(
    "messageId"
  )
    .where((hidden) =>
      and(
        hidden.messageId.in(rows.map((row) => row.id)),
        hidden.userId.eq(user.id)
      )
    )
    .all();
  const alreadyHiddenIds = new Set(alreadyHidden.map((row) => row.messageId));
  const newlyHidden = rows.filter((row) => !alreadyHiddenIds.has(row.id));
  if (newlyHidden.length === 0) {
    return Response.json({ hidden: 0 });
  }

  // The badge is seeded from the DB but then lives as a Redis counter. Hiding a
  // message that was still unread must credit the same number the badge query
  // would have counted, or the counter drifts high until the next reseed.
  // Computed from the rows we already fetched (before they are hidden) using the
  // same rule as `unreadMessageWhere`: peer-authored, newer than the read
  // watermark, not globally deleted.
  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );
  const readAt = myMember?.lastReadAt ?? new Date(0);
  const isUnreadRow = (row: (typeof newlyHidden)[number]) =>
    row.senderId !== user.id &&
    row.deletedAt === null &&
    fromPrismaDateTime(row.createdAt) > readAt;

  // The badge is seeded from the DB but then lives as a Redis counter. Hiding a
  // message that was still unread must credit the same number the badge query
  // would have counted, or the counter drifts high until the next reseed.
  //
  // The credit is derived from the rows that were actually inserted, not from
  // the rows we intended to insert. Two concurrent hides of the same unread
  // message both read the already-hidden set before either has written, so both
  // classify it as newly hidden; the composite primary key then lets only one
  // insert through. Counting intentions would decrement twice for one message
  // and drift the counter below the real unread count, which is far harder to
  // notice than a badge that is merely late. Each insert is attempted
  // individually and a unique-index collision is the loser reporting that
  // someone else already claimed the row.
  // Distinct rows never contend, so these can go in parallel; only a duplicate
  // (messageId, userId) collides, and that one reports itself.
  const insertedFlags = await Promise.all(
    newlyHidden.map(async (row) => {
      try {
        await prisma.orm.public.MessageHiddens.create({
          messageId: row.id,
          userId: user.id,
        });
        return true;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        return false;
      }
    })
  );
  const insertedIds = new Set(
    newlyHidden
      .filter((_row, index) => insertedFlags[index])
      .map((row) => row.id)
  );
  const inserted = insertedIds.size;
  const newlyHiddenUnread = newlyHidden.filter(
    (row) => insertedIds.has(row.id) && isUnreadRow(row)
  ).length;

  if (newlyHiddenUnread > 0) {
    // Best-effort: the hide is already durable, and a dropped badge credit must
    // not turn a successful hide into an error. The next seed reconciles it.
    try {
      await unreadMessageCache.decrement(user.id, newlyHiddenUnread);
    } catch (error) {
      console.error("Failed to decrement unread count after hide:", error);
    }
  }

  return Response.json({ hidden: inserted });
}
