import {
  consumeRateLimit,
  enqueueMessageSearchCount,
  enqueueMessageSearchBackfill,
  fromPrismaDateTime,
  keys,
  listDenMembershipEvents,
  prisma,
  requestMessageSearchCount,
  readMessageSearchViewerEpochCoverage,
  searchMessageCandidates,
  startMessageSearchBackfill,
} from "@asm/db";
import {
  MESSAGE_SEARCH_NORMALIZATION_VERSION,
  messageSearchGramKeys,
  normalizeMessageSearchQuery,
  readMessageSearchFeatureFlags,
} from "@asm/messages/search";

import { getSessionFromApi } from "@/lib/auth/session";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { createMessageSearchCountToken } from "@/lib/messages/search-count-token";
import {
  createMessageSearchSnapshot,
  createMessageSearchCursor,
  messageSearchQueryHash,
  readMessageSearchCursor,
  readMessageSearchSnapshot,
} from "@/lib/messages/search-cursor";
import { recordMessageSearchApiMetric } from "@/lib/messages/search-telemetry";
import { getConversationForUser } from "@/lib/messages/server";

const SEARCH_LIMIT = 20;
const MAX_SEARCH_BODY_BYTES = 16 * 1024;

interface SearchRequestBody {
  cursor?: string;
  query?: string;
  snapshot?: string;
}

function isSearchRequestBody(value: unknown): value is SearchRequestBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    bucket: "message-search",
    identifier: user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Please wait before searching again" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const features = readMessageSearchFeatureFlags({
    MESSAGE_SEARCH_BACKFILL_ENABLED:
      process.env.MESSAGE_SEARCH_BACKFILL_ENABLED,
    MESSAGE_SEARCH_COUNT_ENABLED: process.env.MESSAGE_SEARCH_COUNT_ENABLED,
    MESSAGE_SEARCH_SERVER_ENABLED: process.env.MESSAGE_SEARCH_SERVER_ENABLED,
  });
  if (!features.serverSearch) {
    return Response.json(
      {
        code: "MESSAGE_SEARCH_UNAVAILABLE",
        error: "Search is temporarily unavailable. Please try again.",
      },
      { headers: { "Retry-After": "60" }, status: 503 }
    );
  }

  const { id: conversationId } = await ctx.params;
  let conversation;
  try {
    conversation = await getConversationForUser(conversationId, user.id);
  } catch {
    return Response.json(
      { error: "Search is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SEARCH_BODY_BYTES) {
    return Response.json(
      { error: "Search request is too large" },
      { status: 413 }
    );
  }

  let rawBody: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_SEARCH_BODY_BYTES) {
      return Response.json(
        { error: "Search request is too large" },
        { status: 413 }
      );
    }
    rawBody = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid search request" }, { status: 400 });
  }
  if (!isSearchRequestBody(rawBody) || typeof rawBody.query !== "string") {
    return Response.json(
      { error: "A search query is required" },
      { status: 400 }
    );
  }

  const normalized = normalizeMessageSearchQuery(rawBody.query);
  if (!normalized.valid) {
    const tooLong = [...normalized.normalizedQuery].length > 256;
    return Response.json(
      {
        error: tooLong
          ? "Search queries must be 256 characters or fewer"
          : "Enter at least two characters to search",
      },
      { status: 400 }
    );
  }
  if (rawBody.cursor !== undefined && typeof rawBody.cursor !== "string") {
    return Response.json({ error: "Invalid search cursor" }, { status: 400 });
  }
  if (rawBody.snapshot !== undefined && typeof rawBody.snapshot !== "string") {
    return Response.json({ error: "Invalid search snapshot" }, { status: 400 });
  }
  if (
    (rawBody.cursor !== undefined && rawBody.snapshot !== undefined) ||
    rawBody.cursor === "" ||
    rawBody.snapshot === ""
  ) {
    return Response.json(
      { error: "Invalid search page request" },
      { status: 400 }
    );
  }

  const member = conversation.members.find(
    (candidate) => candidate.userId === user.id
  );
  if (features.backfill) {
    try {
      const started = await startMessageSearchBackfill(conversationId);
      if (started && !started.completedAt) {
        await enqueueMessageSearchBackfill(
          conversationId,
          started.expectedPosition.messageId
        ).catch(() => {
          // The durable coverage row lets the worker sweeper retry after Redis recovers.
          console.error("Failed to enqueue DM search history backfill");
        });
      }
    } catch {
      console.error("Failed to start DM search history coverage");
    }
  }

  const searchState = await Promise.all([
    prisma.orm.public.MessageConversations.select("changeSeq")
      .where({ id: conversationId })
      .first(),
    prisma.orm.public.MessageSearchAccountState.select("recoveryGeneration")
      .where({ userId: user.id })
      .first(),
    prisma.orm.public.MessageSearchCoverage.where({
      conversationId,
    }).first(),
    conversation.type === "DEN"
      ? listDenMembershipEvents(conversationId, member?.leftAt ?? null)
      : Promise.resolve([]),
    readMessageSearchViewerEpochCoverage(conversationId, user.id),
  ]).catch(() => null);
  if (!searchState) {
    return Response.json(
      { error: "Search is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
  const [sequence, recoveryState, coverage, membershipEvents, epochCoverage] =
    searchState;
  const snapshotSequence = sequence?.changeSeq ?? 0;
  const recoveryGeneration = recoveryState?.recoveryGeneration ?? 0;
  const queryHash = messageSearchQueryHash(normalized.tokens.join(" "));
  const cursorScope = {
    conversationId,
    membershipSequence: conversation.membershipSeq ?? 0,
    normalizationVersion: MESSAGE_SEARCH_NORMALIZATION_VERSION,
    queryHash,
    recoveryGeneration,
    userId: user.id,
  };
  let before: { createdAt: Date; messageId: string } | undefined;
  let after: { createdAt: Date; messageId: string } | undefined;
  let effectiveSnapshotSequence = snapshotSequence;
  if (rawBody.cursor !== undefined) {
    const cursor = readMessageSearchCursor(
      rawBody.cursor,
      cursorScope,
      keys.VIEWER_HASH_SECRET
    );
    if (!cursor || cursor.snapshotSequence > snapshotSequence) {
      return Response.json(
        { code: "SEARCH_SCOPE_CHANGED", error: "Start this search again" },
        { status: 409 }
      );
    }
    effectiveSnapshotSequence = cursor.snapshotSequence;
    const boundary = {
      createdAt: new Date(cursor.after.createdAt),
      messageId: cursor.after.messageId,
    };
    if (cursor.direction === "newer") {
      after = boundary;
    } else {
      before = boundary;
    }
  } else if (rawBody.snapshot !== undefined) {
    const snapshot = readMessageSearchSnapshot(
      rawBody.snapshot,
      cursorScope,
      keys.VIEWER_HASH_SECRET
    );
    if (!snapshot || snapshot.snapshotSequence > snapshotSequence) {
      return Response.json(
        { code: "SEARCH_SCOPE_CHANGED", error: "Start this search again" },
        { status: 409 }
      );
    }
    effectiveSnapshotSequence = snapshot.snapshotSequence;
  }

  const windows = readerMessageWindows({
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

  const searchStartedAt = performance.now();
  let searchOutcome: "success" | "unavailable" = "unavailable";
  try {
    const candidates = await searchMessageCandidates({
      after,
      before,
      conversationId,
      fragments: normalized.tokens.map((text) => ({
        grams: messageSearchGramKeys(text),
        text,
      })),
      limit: SEARCH_LIMIT + 1,
      membershipWindows: windows,
      snapshotSequence: effectiveSnapshotSequence,
      userId: user.id,
    });
    const hasMore = candidates.length > SEARCH_LIMIT;
    const hits = candidates.slice(0, SEARCH_LIMIT);
    // Reverse only the bounded visible page, after removing the nearest-first lookahead.
    if (after) {
      hits.reverse();
    }
    const createBoundaryCursor = (
      hit: (typeof hits)[number],
      direction: "newer" | "older"
    ) =>
      createMessageSearchCursor(
        {
          ...cursorScope,
          after: { createdAt: hit.createdAt.toISOString(), messageId: hit.id },
          direction,
          snapshotSequence: effectiveSnapshotSequence,
        },
        keys.VIEWER_HASH_SECRET
      );
    const [firstHit] = hits;
    const lastHit = hits.at(-1);
    const nextCursor =
      lastHit && (after || hasMore)
        ? createBoundaryCursor(lastHit, "older")
        : null;
    const previousCursor =
      firstHit && (before || (after && hasMore))
        ? createBoundaryCursor(firstHit, "newer")
        : null;
    const completedChangeSequence = coverage?.completedChangeSeq ?? 0;
    const coverageSettled =
      coverage?.backfillCompletedAt !== null &&
      coverage?.backfillCompletedAt !== undefined &&
      completedChangeSequence >= effectiveSnapshotSequence &&
      epochCoverage.pending === 0;
    const coverageComplete =
      coverageSettled &&
      coverage?.unrecoverableEpochs === 0 &&
      epochCoverage.unavailable === 0;
    let countToken: string | null = null;
    if (
      rawBody.cursor === undefined &&
      rawBody.snapshot === undefined &&
      hasMore &&
      coverageComplete &&
      features.counts
    ) {
      try {
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const countRequest = await requestMessageSearchCount({
          conversationId,
          expiresAt,
          fragments: normalized.tokens.map((text) => ({
            grams: messageSearchGramKeys(text),
            text,
          })),
          membershipSequence: conversation.membershipSeq ?? 0,
          membershipWindows: windows,
          normalizationVersion: MESSAGE_SEARCH_NORMALIZATION_VERSION,
          queryHash,
          recoveryGeneration,
          snapshotSequence: effectiveSnapshotSequence,
          userId: user.id,
        });
        countToken = createMessageSearchCountToken(
          {
            conversationId,
            expiresAt: countRequest.expiresAt.toISOString(),
            membershipSequence: conversation.membershipSeq ?? 0,
            normalizationVersion: MESSAGE_SEARCH_NORMALIZATION_VERSION,
            queryHash,
            recoveryGeneration,
            requestId: countRequest.id,
            snapshotSequence: effectiveSnapshotSequence,
            userId: user.id,
          },
          keys.VIEWER_HASH_SECRET
        );
        if (countRequest.state === "pending") {
          await enqueueMessageSearchCount(countRequest.id).catch(() => {
            console.error("Failed to enqueue a DM search count request");
          });
        }
      } catch {
        console.error("Failed to create a DM search count request");
      }
    }
    const response = Response.json({
      countToken,
      coverage: {
        artifactsCommitted: coverage?.artifactsCommitted ?? 0,
        complete: coverageComplete,
        completedChangeSequence,
        paused: !features.backfill && !coverageSettled,
        rowsTraversed: coverage?.rowsTraversed ?? 0,
        settled: coverageSettled,
        snapshotSequence: effectiveSnapshotSequence,
        unrecoverableEpochs: Math.max(
          coverage?.unrecoverableEpochs ?? 0,
          epochCoverage.unavailable
        ),
      },
      hits: hits.map((hit) => ({
        createdAt: hit.createdAt,
        id: hit.id,
        keyEpoch: hit.keyEpoch,
        ratchetIndex: hit.ratchetIndex,
        revision: hit.revision,
        senderId: hit.senderId,
      })),
      nextCursor,
      previousCursor,
      snapshotToken: createMessageSearchSnapshot(
        { ...cursorScope, snapshotSequence: effectiveSnapshotSequence },
        keys.VIEWER_HASH_SECRET
      ),
    });
    searchOutcome = "success";
    return response;
  } catch {
    return Response.json(
      { error: "Search is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  } finally {
    recordMessageSearchApiMetric({
      durationMs: performance.now() - searchStartedAt,
      outcome: searchOutcome,
      route: "search",
    });
  }
}
