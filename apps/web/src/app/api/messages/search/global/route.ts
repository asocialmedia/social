import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  consumeRateLimit,
  ensureGlobalMessageSearchBackfills,
  keys,
  listDenMembershipEventsForUser,
  listGlobalMessageSearchScope,
  searchGlobalMessageCandidates,
} from "@asm/db";
import {
  MESSAGE_SEARCH_NORMALIZATION_VERSION,
  messageSearchQueryGramKeys,
  normalizeMessageSearchQuery,
  readMessageSearchFeatureFlags,
} from "@asm/messages/search";

import { getSessionFromApi } from "@/lib/auth/session";
import { parseBoundedJsonBody } from "@/lib/messages/bounded-json";
import { supportsChatLifecycle } from "@/lib/messages/chat-capability";
import {
  createGlobalMessageSearchCursor,
  createGlobalMessageSearchSessionToken,
  readGlobalMessageSearchCursor,
  readGlobalMessageSearchSessionToken,
} from "@/lib/messages/global-message-search-session";
import {
  GLOBAL_SEARCH_SESSION_TTL_SECONDS,
  readGlobalSearchManifest,
  saveGlobalSearchManifest,
} from "@/lib/messages/global-message-search-store";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { messageSearchQueryHash } from "@/lib/messages/search-cursor";

const PAGE_SIZE = 20;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

type ConversationType = "ALL" | "DEN" | "DM";

interface GlobalSearchManifest {
  conversationType: ConversationType;
  coverageComplete: boolean;
  expiresAt: number;
  normalizationVersion: number;
  queryHash: string;
  scope: {
    conversationId: string;
    membershipSequence: number;
    snapshotSequence: number;
    windows: { after: string | null; before: string | null }[];
  }[];
  userId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConversationType(value: unknown): value is ConversationType {
  return value === "ALL" || value === "DM" || value === "DEN";
}

function isManifest(
  value: unknown,
  expected: {
    conversationType: ConversationType;
    expiresAt: number;
    queryHash: string;
    userId: string;
  }
): value is GlobalSearchManifest {
  if (!isRecord(value) || !Array.isArray(value.scope)) {
    return false;
  }
  return (
    value.conversationType === expected.conversationType &&
    typeof value.coverageComplete === "boolean" &&
    value.expiresAt === expected.expiresAt &&
    value.normalizationVersion === MESSAGE_SEARCH_NORMALIZATION_VERSION &&
    value.queryHash === expected.queryHash &&
    value.userId === expected.userId &&
    value.scope.length <= 5000 &&
    value.scope.every((entry) => {
      if (!isRecord(entry) || !Array.isArray(entry.windows)) {
        return false;
      }
      return (
        typeof entry.conversationId === "string" &&
        Number.isSafeInteger(entry.membershipSequence) &&
        Number.isSafeInteger(entry.snapshotSequence) &&
        entry.windows.every(
          (window) =>
            isRecord(window) &&
            (window.after === null || typeof window.after === "string") &&
            (window.before === null || typeof window.before === "string")
        )
      );
    })
  );
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  return Response.json(body, { headers: responseHeaders, status });
}

async function readRequestBody(request: Request): Promise<unknown | Response> {
  try {
    return await parseBoundedJsonBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return jsonResponse({ error: "Search request is too large" }, 413);
    }
    return jsonResponse({ error: "Invalid search request" }, 400);
  }
}

async function createManifest(input: {
  conversationType: ConversationType;
  expiresAt: number;
  queryHash: string;
  userId: string;
}): Promise<{ encoded: string; manifest: GlobalSearchManifest } | null> {
  const rows = await listGlobalMessageSearchScope({
    conversationType: input.conversationType,
    userId: input.userId,
  });
  if (rows.length > 5000) {
    return null;
  }
  const denIds = rows
    .filter((row) => row.conversationType === "DEN")
    .map((row) => row.conversationId);
  const membershipEvents = await listDenMembershipEventsForUser(
    denIds,
    input.userId
  );
  const scope = rows.map((row) => {
    const windows =
      row.conversationType === "DEN"
        ? readerMessageWindows({
            conversationType: row.conversationType,
            events: membershipEvents.get(row.conversationId) ?? [],
            membership: {
              createdAt: row.memberCreatedAt,
              leftAt: row.memberLeftAt,
            },
            userId: input.userId,
          })
        : [{ after: null, before: null }];
    return {
      conversationId: row.conversationId,
      membershipSequence: row.membershipSequence,
      snapshotSequence: row.snapshotSequence,
      windows: windows.map((window) => ({
        after: window.after?.toISOString() ?? null,
        before: window.before?.toISOString() ?? null,
      })),
    };
  });
  const manifest: GlobalSearchManifest = {
    conversationType: input.conversationType,
    coverageComplete: rows.every((row) => row.coverageComplete),
    expiresAt: input.expiresAt,
    normalizationVersion: MESSAGE_SEARCH_NORMALIZATION_VERSION,
    queryHash: input.queryHash,
    scope,
    userId: input.userId,
  };
  const serialized = Buffer.from(JSON.stringify(manifest));
  if (serialized.byteLength > MAX_MANIFEST_BYTES * 4) {
    return null;
  }
  const compressed = gzipSync(serialized);
  if (compressed.byteLength > MAX_MANIFEST_BYTES) {
    return null;
  }
  return { encoded: compressed.toString("base64"), manifest };
}

async function readManifest(input: {
  conversationType: ConversationType;
  sessionId: string;
  sessionToken: string;
  queryHash: string;
  userId: string;
}) {
  try {
    const token = readGlobalMessageSearchSessionToken(
      input.sessionToken,
      { queryHash: input.queryHash, userId: input.userId },
      keys.VIEWER_HASH_SECRET
    );
    if (!token) {
      return null;
    }
    const compressed = await readGlobalSearchManifest({
      expiresAt: token.expiresAt,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    if (!compressed || compressed.length > MAX_MANIFEST_BYTES * 2) {
      return null;
    }
    const json = gunzipSync(Buffer.from(compressed, "base64"), {
      maxOutputLength: MAX_MANIFEST_BYTES * 4,
    }).toString("utf-8");
    const value: unknown = JSON.parse(json);
    if (
      !isManifest(value, {
        conversationType: input.conversationType,
        expiresAt: token.expiresAt,
        queryHash: input.queryHash,
        userId: input.userId,
      })
    ) {
      return null;
    }
    return { manifest: value, token };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const limited = await consumeRateLimit({
    bucket: "message-global-search",
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return jsonResponse(
      { code: "RATE_LIMITED", error: "Please wait before searching again" },
      429,
      { "Retry-After": String(limited.retryAfterSeconds) }
    );
  }

  const features = readMessageSearchFeatureFlags({
    MESSAGE_SEARCH_BACKFILL_ENABLED:
      process.env.MESSAGE_SEARCH_BACKFILL_ENABLED,
    MESSAGE_SEARCH_COUNT_ENABLED: process.env.MESSAGE_SEARCH_COUNT_ENABLED,
    MESSAGE_SEARCH_GLOBAL_ENABLED: process.env.MESSAGE_SEARCH_GLOBAL_ENABLED,
    MESSAGE_SEARCH_SERVER_ENABLED: process.env.MESSAGE_SEARCH_SERVER_ENABLED,
  });
  if (!features.serverSearch || !features.globalSearch) {
    return jsonResponse(
      {
        code: "MESSAGE_SEARCH_UNAVAILABLE",
        error: "Message search is temporarily unavailable. Please try again.",
      },
      503,
      { "Retry-After": "60" }
    );
  }
  if (!supportsChatLifecycle(request)) {
    return jsonResponse(
      {
        code: "CHAT_UPDATE_REQUIRED",
        error: "Update the app to search messages safely.",
      },
      426
    );
  }

  const rawBody = await readRequestBody(request);
  if (rawBody instanceof Response) {
    return rawBody;
  }
  if (!isRecord(rawBody) || typeof rawBody.query !== "string") {
    return jsonResponse({ error: "A search query is required" }, 400);
  }
  const conversationType = rawBody.conversationType ?? "ALL";
  if (!isConversationType(conversationType)) {
    return jsonResponse({ error: "Invalid conversation filter" }, 400);
  }
  if (
    (rawBody.cursor !== undefined && typeof rawBody.cursor !== "string") ||
    (rawBody.sessionToken !== undefined &&
      typeof rawBody.sessionToken !== "string") ||
    (rawBody.cursor !== undefined && rawBody.sessionToken === undefined)
  ) {
    return jsonResponse({ error: "Invalid search page request" }, 400);
  }

  const normalized = normalizeMessageSearchQuery(rawBody.query);
  if (!normalized.valid) {
    const tooLong = [...normalized.normalizedQuery].length > 256;
    return jsonResponse(
      {
        error: tooLong
          ? "Search queries must be 256 characters or fewer"
          : "Enter at least two characters to search",
      },
      400
    );
  }

  const queryHash = messageSearchQueryHash(normalized.tokens.join(" "));
  let manifest: GlobalSearchManifest;
  let sessionToken: string;
  let sessionId: string;
  const { sessionToken: requestedSessionToken } = rawBody;
  if (typeof requestedSessionToken === "string") {
    const parsedToken = readGlobalMessageSearchSessionToken(
      requestedSessionToken,
      { queryHash, userId: user.id },
      keys.VIEWER_HASH_SECRET
    );
    if (!parsedToken) {
      return jsonResponse(
        { code: "SEARCH_SCOPE_CHANGED", error: "Start this search again" },
        409
      );
    }
    const stored = await readManifest({
      conversationType,
      queryHash,
      sessionId: parsedToken.sessionId,
      sessionToken: requestedSessionToken,
      userId: user.id,
    });
    if (!stored) {
      return jsonResponse(
        { code: "SEARCH_SCOPE_CHANGED", error: "Start this search again" },
        409
      );
    }
    const {
      manifest: storedManifest,
      token: { sessionId: storedSessionId },
    } = stored;
    manifest = storedManifest;
    sessionToken = requestedSessionToken;
    sessionId = storedSessionId;
  } else {
    const expiresAt = Date.now() + GLOBAL_SEARCH_SESSION_TTL_SECONDS * 1000;
    try {
      const created = await createManifest({
        conversationType,
        expiresAt,
        queryHash,
        userId: user.id,
      });
      if (!created) {
        return jsonResponse(
          {
            code: "GLOBAL_SEARCH_SCOPE_TOO_LARGE",
            error:
              "This account has too many conversations to search at once. Narrow the filter and try again.",
          },
          413
        );
      }
      const { encoded, manifest: createdManifest } = created;
      manifest = createdManifest;
      sessionId = randomUUID();
      sessionToken = createGlobalMessageSearchSessionToken(
        { expiresAt, queryHash, sessionId, userId: user.id },
        keys.VIEWER_HASH_SECRET
      );
      await saveGlobalSearchManifest({
        encoded,
        expiresAt,
        sessionId,
        userId: user.id,
      });
      if (features.backfill) {
        await ensureGlobalMessageSearchBackfills(
          manifest.coverageComplete
            ? []
            : manifest.scope.map((entry) => entry.conversationId)
        );
      }
    } catch {
      return jsonResponse(
        {
          error: "Message search is temporarily unavailable. Please try again.",
        },
        503,
        { "Retry-After": "15" }
      );
    }
  }

  let after:
    | { conversationId: string; createdAt: Date; messageId: string }
    | undefined;
  if (typeof rawBody.cursor === "string") {
    const cursor = readGlobalMessageSearchCursor(
      rawBody.cursor,
      { sessionId, userId: user.id },
      keys.VIEWER_HASH_SECRET
    );
    if (!cursor) {
      return jsonResponse(
        { code: "SEARCH_SCOPE_CHANGED", error: "Start this search again" },
        409
      );
    }
    after = {
      conversationId: cursor.conversationId,
      createdAt: new Date(cursor.createdAt),
      messageId: cursor.messageId,
    };
  }

  try {
    const fragments = normalized.tokens.map((text) => ({
      grams: messageSearchQueryGramKeys(text),
      text,
    }));
    const candidates =
      manifest.scope.length === 0
        ? []
        : await searchGlobalMessageCandidates({
            after,
            fragments,
            limit: PAGE_SIZE + 1,
            scope: manifest.scope,
            userId: user.id,
          });
    const hits = candidates.slice(0, PAGE_SIZE);
    const buildResponse = () => {
      const hasMore = candidates.length > hits.length;
      const last = hits.at(-1);
      const nextCursor =
        hasMore && last
          ? createGlobalMessageSearchCursor(
              {
                conversationId: last.conversationId,
                createdAt: last.createdAt.toISOString(),
                messageId: last.id,
                sessionId,
                userId: user.id,
              },
              keys.VIEWER_HASH_SECRET
            )
          : null;
      return {
        coverageComplete: manifest.coverageComplete,
        coveragePaused: !features.backfill && !manifest.coverageComplete,
        hasMore,
        hits: hits.map((hit) => ({
          ciphertext: hit.ciphertext,
          conversationAvatarMediaId: hit.conversationAvatarMediaId,
          conversationId: hit.conversationId,
          conversationName: hit.conversationName,
          conversationType: hit.conversationType,
          createdAt: hit.createdAt.toISOString(),
          expiresAt: hit.expiresAt?.toISOString() ?? null,
          id: hit.id,
          iv: hit.iv,
          keyEpoch: hit.keyEpoch,
          peerAvatarUrl: hit.peerAvatarUrl,
          peerName: hit.peerName,
          peerUsername: hit.peerUsername,
          ratchetIndex: hit.ratchetIndex,
          revision: hit.revision,
          rootKeyCiphertext: hit.rootKeyCiphertext,
          rootKeyIv: hit.rootKeyIv,
          rootKeyWrapperPublicKey: hit.rootKeyWrapperPublicKey,
          senderId: hit.senderId,
          senderName: hit.senderName,
          senderUsername: hit.senderUsername,
        })),
        nextCursor,
        sessionToken,
      };
    };
    let responseBody = buildResponse();
    let responseSize = new TextEncoder().encode(
      JSON.stringify(responseBody)
    ).byteLength;
    while (responseSize > 1024 * 1024 && hits.length > 1) {
      hits.pop();
      responseBody = buildResponse();
      responseSize = new TextEncoder().encode(
        JSON.stringify(responseBody)
      ).byteLength;
    }
    if (responseSize > 1024 * 1024) {
      return jsonResponse(
        {
          code: "GLOBAL_SEARCH_PAGE_TOO_LARGE",
          error:
            "This search page contains too much message data. Refine the query.",
        },
        413
      );
    }
    return jsonResponse(responseBody);
  } catch {
    return jsonResponse(
      { error: "Message search is temporarily unavailable. Please try again." },
      503,
      { "Retry-After": "15" }
    );
  }
}
