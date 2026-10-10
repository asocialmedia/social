import {
  consumeRateLimit,
  fromPrismaDateTime,
  keys,
  listDenMembershipEvents,
  listMessageConversationChanges,
  prisma,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  createMessageChangeCursor,
  readMessageChangeCursor,
} from "@/lib/messages/change-cursor";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { getConversationForUser } from "@/lib/messages/server";

const CHANGE_PAGE_SIZE = 100;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await consumeRateLimit({
    bucket: "message-changes",
    identifier: user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return Response.json(
      { error: "Please wait before syncing conversation changes" },
      {
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const { id: conversationId } = await ctx.params;
  let conversation;
  try {
    conversation = await getConversationForUser(conversationId, user.id);
  } catch {
    return Response.json(
      { error: "Changes are temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const hasCursor = url.searchParams.has("cursor");
  const cursorToken = url.searchParams.get("cursor");
  if (hasCursor && !cursorToken) {
    return Response.json({ error: "Invalid changes cursor" }, { status: 400 });
  }

  const member = conversation.members.find(
    (candidate) => candidate.userId === user.id
  );
  try {
    const [sequence, recoveryState, membershipEvents] = await Promise.all([
      prisma.orm.public.MessageConversations.select("changeSeq")
        .where({ id: conversationId })
        .first(),
      prisma.orm.public.MessageSearchAccountState.select("recoveryGeneration")
        .where({ userId: user.id })
        .first(),
      conversation.type === "DEN"
        ? listDenMembershipEvents(conversationId, member?.leftAt ?? null)
        : Promise.resolve([]),
    ]);
    const currentSequence = sequence?.changeSeq ?? 0;
    const membershipSequence = conversation.membershipSeq ?? 0;
    const recoveryGeneration = recoveryState?.recoveryGeneration ?? 0;
    const scope = {
      conversationId,
      membershipSequence,
      recoveryGeneration,
      userId: user.id,
    };
    let afterSequence = 0;
    let snapshotSequence = currentSequence;
    let resetRequired = !cursorToken;

    if (cursorToken) {
      const result = readMessageChangeCursor(
        cursorToken,
        scope,
        keys.VIEWER_HASH_SECRET
      );
      const cursor = result.status === "valid" ? result.cursor : null;
      const { afterSequence: cursorAfter, snapshotSequence: cursorSnapshot } =
        cursor ?? { afterSequence: 0, snapshotSequence: 0 };
      if (result.status !== "valid") {
        resetRequired = true;
      } else if (!cursor || cursorSnapshot > currentSequence) {
        resetRequired = true;
      } else if (cursorAfter >= cursorSnapshot) {
        snapshotSequence = currentSequence;
        afterSequence = Math.min(cursorAfter, currentSequence);
      } else {
        snapshotSequence = cursorSnapshot;
        afterSequence = cursorAfter;
      }
    }

    if (resetRequired) {
      return Response.json({
        changes: [],
        nextCursor: createMessageChangeCursor(
          {
            ...scope,
            afterSequence: currentSequence,
            snapshotSequence: currentSequence,
          },
          keys.VIEWER_HASH_SECRET
        ),
        resetRequired: true,
        snapshotSequence: currentSequence,
      });
    }

    const membershipWindows = readerMessageWindows({
      conversationType: conversation.type,
      events: membershipEvents,
      membership: member
        ? {
            createdAt: fromPrismaDateTime(member.createdAt),
            leftAt: member.leftAt,
          }
        : null,
      userId: user.id,
    });
    const rows = await listMessageConversationChanges({
      afterSequence,
      conversationId,
      limit: CHANGE_PAGE_SIZE + 1,
      membershipWindows,
      snapshotSequence,
      userId: user.id,
    });
    const hasMore = rows.length > CHANGE_PAGE_SIZE;
    const changes = rows.slice(0, CHANGE_PAGE_SIZE);
    const lastSequence = changes.at(-1)?.sequence;
    const nextAfterSequence = hasMore
      ? (lastSequence ?? afterSequence)
      : snapshotSequence;
    const nextCursor = createMessageChangeCursor(
      {
        ...scope,
        afterSequence: nextAfterSequence,
        snapshotSequence,
      },
      keys.VIEWER_HASH_SECRET
    );

    return Response.json({
      changes: changes.map((change) => ({
        globallyDeleted: change.globallyDeleted ?? false,
        hiddenForViewer: change.hiddenForViewer ?? false,
        id: change.id,
        kind: change.kind,
        messageId: change.messageId,
        revision: change.revision,
        sequence: change.sequence,
        sourceAvailable: change.sourceAvailable ?? change.messageId === null,
        sourceRevision: change.sourceRevision ?? null,
      })),
      nextCursor,
      resetRequired: false,
      snapshotSequence,
    });
  } catch (error) {
    console.error("Failed to read durable message changes", error);
    return Response.json(
      { error: "Changes are temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
