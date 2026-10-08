import {
  consumeRateLimit,
  enqueueMessageSearchBackfill,
  fromPrismaDateTime,
  keys,
  listDenMembershipEvents,
  listMessageSearchReferences,
  prisma,
  startMessageSearchBackfill,
} from "@asm/db";
import { readMessageSearchFeatureFlags } from "@asm/messages/search";

import { getSessionFromApi } from "@/lib/auth/session";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { getConversationForUser } from "@/lib/messages/server";
import {
  createSharedRefCursor,
  readSharedRefCursor,
} from "@/lib/messages/shared-ref-cursor";

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 100;

function parsePageSize(value: string | null): number {
  if (value === null) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!/^\d{1,3}$/u.test(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Number(value), 1), MAX_PAGE_SIZE);
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rateLimit = await consumeRateLimit({
    bucket: "message-shared-references",
    identifier: user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Please wait before loading shared items" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      }
    );
  }
  const flags = readMessageSearchFeatureFlags({
    MESSAGE_SEARCH_BACKFILL_ENABLED:
      process.env.MESSAGE_SEARCH_BACKFILL_ENABLED,
    MESSAGE_SEARCH_COUNT_ENABLED: process.env.MESSAGE_SEARCH_COUNT_ENABLED,
    MESSAGE_SEARCH_SERVER_ENABLED: process.env.MESSAGE_SEARCH_SERVER_ENABLED,
  });
  if (!flags.serverSearch) {
    return Response.json(
      { error: "Shared items are temporarily unavailable" },
      { headers: { "Retry-After": "60" }, status: 503 }
    );
  }

  const { id: conversationId } = await ctx.params;
  let conversation;
  try {
    conversation = await getConversationForUser(conversationId, user.id);
  } catch {
    return Response.json(
      { error: "Shared items are temporarily unavailable" },
      { status: 503 }
    );
  }
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const member = conversation.members.find(
    (candidate) => candidate.userId === user.id
  );
  if (!member) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const kindValue = url.searchParams.get("kind");
  if (kindValue !== "link" && kindValue !== "media" && kindValue !== "post") {
    return Response.json(
      { error: "Choose a valid shared item type" },
      { status: 400 }
    );
  }
  const cursorToken = url.searchParams.get("cursor");
  if (cursorToken !== null && cursorToken.length > 2048) {
    return Response.json(
      { error: "Shared items cursor is invalid" },
      { status: 400 }
    );
  }

  try {
    const [sequence, recoveryState, membershipEvents, coverage] =
      await Promise.all([
        prisma.orm.public.MessageConversations.select("changeSeq")
          .where({ id: conversationId })
          .first(),
        prisma.orm.public.MessageSearchAccountState.select("recoveryGeneration")
          .where({ userId: user.id })
          .first(),
        conversation.type === "DEN"
          ? listDenMembershipEvents(conversationId, member.leftAt ?? null)
          : Promise.resolve([]),
        prisma.orm.public.MessageSearchCoverage.select(
          "backfillCompletedAt",
          "completedChangeSeq",
          "unrecoverableEpochs"
        )
          .where({ conversationId })
          .first(),
      ]);
    const membershipSequence = conversation.membershipSeq ?? 0;
    const recoveryGeneration = recoveryState?.recoveryGeneration ?? 0;
    if (flags.backfill) {
      try {
        const started = await startMessageSearchBackfill(conversationId);
        if (started && !started.completedAt) {
          await enqueueMessageSearchBackfill(
            conversationId,
            started.expectedPosition.messageId
          ).catch(() => {
            // Durable coverage lets the worker sweeper retry after Redis recovers.
          });
        }
      } catch {
        // The bounded read can still serve already indexed references.
      }
    }
    const scope = {
      conversationId,
      kind: kindValue,
      membershipSequence,
      recoveryGeneration,
      userId: user.id,
    } as const;
    const cursor = cursorToken
      ? readSharedRefCursor(cursorToken, scope, keys.VIEWER_HASH_SECRET)
      : null;
    if (cursorToken && !cursor) {
      return Response.json(
        { error: "Shared items cursor is invalid" },
        { status: 400 }
      );
    }
    const snapshotSequence =
      cursor?.snapshotSequence ?? sequence?.changeSeq ?? 0;
    const coverageComplete =
      coverage?.backfillCompletedAt !== null &&
      coverage?.backfillCompletedAt !== undefined &&
      coverage.completedChangeSeq >= snapshotSequence &&
      coverage.unrecoverableEpochs === 0;
    const membershipWindows = readerMessageWindows({
      conversationType: conversation.type,
      events: membershipEvents,
      membership: {
        createdAt: fromPrismaDateTime(member.createdAt),
        leftAt: member.leftAt,
      },
      userId: user.id,
    });
    const pageSize = parsePageSize(url.searchParams.get("limit"));
    const rows = await listMessageSearchReferences({
      ...(cursor
        ? {
            after: {
              ...cursor.after,
              createdAt: new Date(cursor.after.createdAt),
            },
          }
        : {}),
      conversationId,
      kind: kindValue,
      limit: pageSize + 1,
      membershipWindows,
      snapshotSequence,
      userId: user.id,
    });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    const nextCursor =
      hasMore && last
        ? createSharedRefCursor(
            {
              after: {
                createdAt: last.createdAt.toISOString(),
                messageId: last.messageId,
                ordinal: last.ordinal,
              },
              ...scope,
              snapshotSequence,
            },
            keys.VIEWER_HASH_SECRET
          )
        : null;
    return Response.json({
      coverageComplete,
      hasMore,
      items: items.map((item) => ({
        createdAt: item.createdAt,
        keyEpoch: item.keyEpoch,
        kind: kindValue,
        mediaKind: item.mediaKind,
        messageId: item.messageId,
        ordinal: item.ordinal,
        ratchetIndex: item.ratchetIndex,
        requiredId: item.requiredId,
        revision: item.revision,
        senderId: item.senderId,
      })),
      nextCursor,
      snapshotSequence,
    });
  } catch {
    return Response.json(
      { error: "Shared items are temporarily unavailable" },
      { status: 503 }
    );
  }
}
