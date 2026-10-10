import {
  consumeRateLimit,
  enqueueMessageSearchBackfill,
  fromPrismaDateTime,
  keys,
  listDenMembershipEvents,
  listMessageSearchReferences,
  prisma,
  startMessageSearchBackfill,
  readMessageSearchViewerEpochCoverage,
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
  const aroundMessageId = url.searchParams.get("aroundMessageId");
  const aroundCreatedAt = url.searchParams.get("aroundCreatedAt");
  const aroundOrdinalText = url.searchParams.get("aroundOrdinal");
  const hasAroundParameter =
    aroundMessageId !== null ||
    aroundCreatedAt !== null ||
    aroundOrdinalText !== null;
  const aroundCreatedAtDate = aroundCreatedAt
    ? new Date(aroundCreatedAt)
    : null;
  const aroundOrdinal =
    aroundOrdinalText && /^\d{1,3}$/u.test(aroundOrdinalText)
      ? Number(aroundOrdinalText)
      : null;
  if (
    (hasAroundParameter &&
      (!aroundMessageId ||
        aroundMessageId.length > 128 ||
        !aroundCreatedAtDate ||
        !Number.isFinite(aroundCreatedAtDate.getTime()) ||
        aroundOrdinal === null ||
        aroundOrdinal > 999)) ||
    (hasAroundParameter && cursorToken)
  ) {
    return Response.json(
      { error: "Shared items position is invalid" },
      { status: 400 }
    );
  }

  try {
    const [sequence, recoveryState, membershipEvents, coverage, epochCoverage] =
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
          "unrecoverableEpochs",
          "hasUnreadableMessages"
        )
          .where({ conversationId })
          .first(),
        readMessageSearchViewerEpochCoverage(conversationId, user.id),
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
    const coverageSettled =
      coverage?.backfillCompletedAt !== null &&
      coverage?.backfillCompletedAt !== undefined &&
      coverage.completedChangeSeq >= snapshotSequence &&
      epochCoverage.pending === 0;
    const coverageComplete =
      coverageSettled &&
      coverage?.unrecoverableEpochs === 0 &&
      coverage?.hasUnreadableMessages !== true &&
      epochCoverage.unavailable === 0;
    const coveragePaused = !flags.backfill && !coverageSettled;
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
    if (hasAroundParameter && aroundMessageId && aroundCreatedAtDate) {
      const anchor = {
        createdAt: aroundCreatedAtDate,
        messageId: aroundMessageId,
        ordinal: aroundOrdinal ?? 0,
      };
      const olderSize = Math.floor(Math.max(pageSize - 1, 0) / 2);
      const newerSize = Math.max(pageSize - 1 - olderSize, 0);
      const [olderRows, newerRows] = await Promise.all([
        listMessageSearchReferences({
          after: anchor,
          conversationId,
          kind: kindValue,
          limit: olderSize + 1,
          membershipWindows,
          snapshotSequence,
          userId: user.id,
        }),
        listMessageSearchReferences({
          before: anchor,
          conversationId,
          kind: kindValue,
          limit: newerSize + 1,
          membershipWindows,
          snapshotSequence,
          userId: user.id,
        }),
      ]);
      const hasOlder = olderRows.length > olderSize;
      const hasNewer = newerRows.length > newerSize;
      const olderItems = olderRows.slice(0, olderSize);
      const newerItems = newerRows.slice(0, newerSize).toReversed();
      const olderBoundary = olderItems.at(-1) ?? anchor;
      const newerBoundary = newerRows.slice(0, newerSize).at(-1) ?? anchor;
      const olderCursor = hasOlder
        ? createSharedRefCursor(
            {
              after: {
                createdAt: olderBoundary.createdAt.toISOString(),
                messageId: olderBoundary.messageId,
                ordinal: olderBoundary.ordinal,
              },
              direction: "older",
              ...scope,
              snapshotSequence,
            },
            keys.VIEWER_HASH_SECRET
          )
        : null;
      const newerCursor = hasNewer
        ? createSharedRefCursor(
            {
              after: {
                createdAt: newerBoundary.createdAt.toISOString(),
                messageId: newerBoundary.messageId,
                ordinal: newerBoundary.ordinal,
              },
              direction: "newer",
              ...scope,
              snapshotSequence,
            },
            keys.VIEWER_HASH_SECRET
          )
        : null;
      return Response.json({
        coverageComplete,
        coveragePaused,
        coverageSettled,
        hasMore: hasOlder || hasNewer,
        items: [...newerItems, ...olderItems].map((item) => ({
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
        nextCursor: null,
        snapshotSequence,
        window: { hasNewer, hasOlder, newerCursor, olderCursor },
      });
    }
    let cursorPosition: {
      after?: { createdAt: Date; messageId: string; ordinal: number };
      before?: { createdAt: Date; messageId: string; ordinal: number };
    } = {};
    if (cursor) {
      const position = {
        ...cursor.after,
        createdAt: new Date(cursor.after.createdAt),
      };
      cursorPosition =
        cursor.direction === "newer"
          ? { before: position }
          : { after: position };
    }
    const rows = await listMessageSearchReferences({
      ...cursorPosition,
      conversationId,
      kind: kindValue,
      limit: pageSize + 1,
      membershipWindows,
      snapshotSequence,
      userId: user.id,
    });
    const hasMore = rows.length > pageSize;
    const rowsInQueryOrder = rows.slice(0, pageSize);
    const items =
      cursor?.direction === "newer"
        ? rowsInQueryOrder.toReversed()
        : rowsInQueryOrder;
    const last = rowsInQueryOrder.at(-1);
    const nextCursor =
      hasMore && last
        ? createSharedRefCursor(
            {
              after: {
                createdAt: last.createdAt.toISOString(),
                messageId: last.messageId,
                ordinal: last.ordinal,
              },
              direction: cursor?.direction ?? "older",
              ...scope,
              snapshotSequence,
            },
            keys.VIEWER_HASH_SECRET
          )
        : null;
    return Response.json({
      coverageComplete,
      coveragePaused,
      coverageSettled,
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
