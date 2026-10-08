import {
  consumeRateLimit,
  enqueueMessageSearchCount,
  enqueueMessageSearchBackfill,
  fromPrismaDateTime,
  keys,
  listDenMembershipEvents,
  prisma,
  requestMessageSearchCount,
  searchMessageCandidates,
  startMessageSearchBackfill,
} from "@asm/db";
import {
  MESSAGE_SEARCH_NORMALIZATION_VERSION,
  messageSearchGramKeys,
  normalizeMessageSearchQuery,
} from "@asm/messages/search";

import { getSessionFromApi } from "@/lib/auth/session";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { createMessageSearchCountToken } from "@/lib/messages/search-count-token";
import {
  createMessageSearchCursor,
  messageSearchQueryHash,
  readMessageSearchCursor,
} from "@/lib/messages/search-cursor";
import { getConversationForUser } from "@/lib/messages/server";

const SEARCH_LIMIT = 20;
const MAX_SEARCH_BODY_BYTES = 16 * 1024;

interface SearchRequestBody {
  cursor?: string;
  query?: string;
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

  const member = conversation.members.find(
    (candidate) => candidate.userId === user.id
  );
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
  ]).catch(() => null);
  if (!searchState) {
    return Response.json(
      { error: "Search is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
  const [sequence, recoveryState, coverage, membershipEvents] = searchState;
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
  let effectiveSnapshotSequence = snapshotSequence;
  if (rawBody.cursor) {
    const cursor = readMessageSearchCursor(
      rawBody.cursor,
      cursorScope,
      keys.VIEWER_HASH_SECRET
    );
    if (!cursor) {
      return Response.json(
        { code: "SEARCH_SCOPE_CHANGED", error: "Start this search again" },
        { status: 409 }
      );
    }
    effectiveSnapshotSequence = cursor.snapshotSequence;
    before = {
      createdAt: new Date(cursor.after.createdAt),
      messageId: cursor.after.messageId,
    };
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

  try {
    const candidates = await searchMessageCandidates({
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
    const lastHit = hits.at(-1);
    const nextCursor =
      hasMore && lastHit
        ? createMessageSearchCursor(
            {
              ...cursorScope,
              after: {
                createdAt: lastHit.createdAt.toISOString(),
                messageId: lastHit.id,
              },
              snapshotSequence: effectiveSnapshotSequence,
            },
            keys.VIEWER_HASH_SECRET
          )
        : null;
    const completedChangeSequence = coverage?.completedChangeSeq ?? 0;
    const coverageComplete =
      coverage?.backfillCompletedAt !== null &&
      coverage?.backfillCompletedAt !== undefined &&
      completedChangeSequence >= effectiveSnapshotSequence &&
      coverage.unrecoverableEpochs === 0;
    let countToken: string | null = null;
    if (!rawBody.cursor && hasMore && coverageComplete) {
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
    return Response.json({
      countToken,
      coverage: {
        artifactsCommitted: coverage?.artifactsCommitted ?? 0,
        complete: coverageComplete,
        completedChangeSequence,
        rowsTraversed: coverage?.rowsTraversed ?? 0,
        snapshotSequence: effectiveSnapshotSequence,
        unrecoverableEpochs: coverage?.unrecoverableEpochs ?? 0,
      },
      hits,
      nextCursor,
    });
  } catch {
    return Response.json(
      { error: "Search is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
