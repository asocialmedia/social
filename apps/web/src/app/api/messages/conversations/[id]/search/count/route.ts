import {
  consumeRateLimit,
  getMessageSearchCountRequestStatus,
  keys,
  prisma,
} from "@asm/db";
import { readMessageSearchFeatureFlags } from "@asm/messages/search";

import { getSessionFromApi } from "@/lib/auth/session";
import { readMessageSearchCountToken } from "@/lib/messages/search-count-token";
import { getConversationForUser } from "@/lib/messages/server";

const MAX_COUNT_REQUEST_BYTES = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
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
    bucket: "message-search-count",
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Please wait before checking this search" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const { id: conversationId } = await ctx.params;
  try {
    const conversation = await getConversationForUser(conversationId, user.id);
    if (!conversation) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    const features = readMessageSearchFeatureFlags({
      MESSAGE_SEARCH_BACKFILL_ENABLED:
        process.env.MESSAGE_SEARCH_BACKFILL_ENABLED,
      MESSAGE_SEARCH_COUNT_ENABLED: process.env.MESSAGE_SEARCH_COUNT_ENABLED,
      MESSAGE_SEARCH_SERVER_ENABLED: process.env.MESSAGE_SEARCH_SERVER_ENABLED,
    });
    if (!features.serverSearch || !features.counts) {
      return Response.json({ state: "unavailable" });
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_COUNT_REQUEST_BYTES) {
      return Response.json(
        { error: "Count token is too large" },
        { status: 413 }
      );
    }
    const bodyText = await request.text();
    if (
      new TextEncoder().encode(bodyText).byteLength > MAX_COUNT_REQUEST_BYTES
    ) {
      return Response.json(
        { error: "Count token is too large" },
        { status: 413 }
      );
    }
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return Response.json({ error: "Invalid count request" }, { status: 400 });
    }
    if (
      !isRecord(rawBody) ||
      typeof rawBody.token !== "string" ||
      rawBody.token.length > 2048
    ) {
      return Response.json({ error: "Invalid count token" }, { status: 400 });
    }
    const token = readMessageSearchCountToken(
      rawBody.token,
      { conversationId, userId: user.id },
      keys.VIEWER_HASH_SECRET
    );
    if (!token) {
      return Response.json({ state: "unavailable" });
    }

    const member = conversation.members.find(
      (candidate) => candidate.userId === user.id
    );
    const [sequence, recoveryState, coverage, stored] = await Promise.all([
      prisma.orm.public.MessageConversations.select("changeSeq")
        .where({ id: conversationId })
        .first(),
      prisma.orm.public.MessageSearchAccountState.select("recoveryGeneration")
        .where({ userId: user.id })
        .first(),
      prisma.orm.public.MessageSearchCoverage.select(
        "backfillCompletedAt",
        "completedChangeSeq",
        "unrecoverableEpochs",
        "hasUnreadableMessages"
      )
        .where({ conversationId })
        .first(),
      getMessageSearchCountRequestStatus({
        conversationId,
        id: token.requestId,
        userId: user.id,
      }),
    ]);
    if (!stored) {
      return Response.json({ state: "unavailable" });
    }
    const scopeMatches =
      stored.id === token.requestId &&
      stored.userId === token.userId &&
      stored.conversationId === token.conversationId &&
      stored.queryHash === token.queryHash &&
      stored.normalizationVersion === token.normalizationVersion &&
      stored.snapshotSequence === token.snapshotSequence &&
      stored.membershipSequence === token.membershipSequence &&
      stored.recoveryGeneration === token.recoveryGeneration &&
      stored.expiresAt.toISOString() === token.expiresAt;
    const currentScopeMatches =
      scopeMatches &&
      (conversation.membershipSeq ?? 0) === token.membershipSequence &&
      (sequence?.changeSeq ?? 0) === token.snapshotSequence &&
      (recoveryState?.recoveryGeneration ?? 0) === token.recoveryGeneration &&
      coverage?.backfillCompletedAt !== null &&
      coverage?.backfillCompletedAt !== undefined &&
      coverage.completedChangeSeq >= token.snapshotSequence &&
      coverage.unrecoverableEpochs === 0 &&
      !coverage.hasUnreadableMessages &&
      member?.leftAt === null;
    if (!currentScopeMatches) {
      return Response.json({ state: "unavailable" });
    }
    if (stored.state === "exact" && stored.exactCount !== null) {
      return Response.json({ count: stored.exactCount, state: "exact" });
    }
    if (stored.state === "pending" || stored.state === "running") {
      return Response.json({ state: "pending" });
    }
    return Response.json({ state: "unavailable" });
  } catch {
    return Response.json(
      { error: "Search count is temporarily unavailable" },
      { status: 503 }
    );
  }
}
