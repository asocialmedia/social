import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { GlobalSearchCandidateRow } from "@asm/db";

import { POST } from "./route";

let signedIn = true;
let allowed = true;
let scopeRows: {
  clearedAt: Date | null;
  clearedThroughSequence: number;
  conversationAvatarMediaId: string | null;
  conversationId: string;
  conversationName: string | null;
  conversationType: "DEN" | "DM";
  coverageComplete: boolean;
  memberCreatedAt: Date;
  memberLeftAt: Date | null;
  membershipSequence: number;
  peerAvatarUrl: string | null;
  peerName: string | null;
  peerUsername: string | null;
  snapshotSequence: number;
}[];
let candidateRows: GlobalSearchCandidateRow[];
let backfillIds: readonly string[] = [];
const sessions = new Map<string, Map<string, string>>();

const mockGetSession = mock(() =>
  Promise.resolve(signedIn ? { user: { id: "user-1" } } : null)
);
const mockRateLimit = mock(() =>
  Promise.resolve({
    allowed,
    remaining: 29,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 20,
  })
);
const mockEnsureBackfills = mock((ids: readonly string[]) => {
  backfillIds = ids;
  return Promise.resolve();
});
const mockListScope = mock(() => Promise.resolve(scopeRows));
const mockSearchCandidates = mock((_input?: unknown) =>
  Promise.resolve(candidateRows)
);
const mockListDenEvents = mock(() => Promise.resolve(new Map()));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  ensureGlobalMessageSearchBackfills: mockEnsureBackfills,
  keys: { VIEWER_HASH_SECRET: "global-route-test-secret" },
  listDenMembershipEventsForUser: mockListDenEvents,
  listGlobalMessageSearchScope: mockListScope,
  redis: {
    eval: (
      _script: string,
      _keyCount: number,
      key: string,
      field: string,
      value: string,
      now: number,
      _ttl: number,
      maximum: number
    ) => {
      const fields = sessions.get(key) ?? new Map<string, string>();
      for (const storedField of fields.keys()) {
        if (Number(storedField.split(":")[0]) <= now) {
          fields.delete(storedField);
        }
      }
      fields.set(field, value);
      for (const storedField of [...fields.keys()].toSorted()) {
        if (fields.size > maximum && storedField !== field) {
          fields.delete(storedField);
        }
      }
      sessions.set(key, fields);
      return Promise.resolve(1);
    },
    hget: (key: string, field: string) =>
      Promise.resolve(sessions.get(key)?.get(field) ?? null),
  },
  searchGlobalMessageCandidates: (input: unknown) => {
    mockSearchCandidates(input);
    return Promise.resolve(candidateRows);
  },
}));

function request(
  body: unknown,
  options: { capability?: boolean } = {}
): Request {
  return new Request("https://app.example/api/messages/search/global", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(options.capability === false
        ? {}
        : { "X-Chat-Capability": "chat-lifecycle-v1" }),
    },
    method: "POST",
  });
}

function candidate(index: number): GlobalSearchCandidateRow {
  return {
    ciphertext: `encrypted-${index}`,
    conversationAvatarMediaId: null,
    conversationId: "conversation-1",
    conversationName: null,
    conversationType: "DM",
    createdAt: new Date(1_800_000_000_000 - index),
    expiresAt: null,
    id: `message-${index}`,
    iv: `iv-${index}`,
    keyEpoch: 1,
    peerAvatarUrl: null,
    peerName: "Ada",
    peerUsername: "ada",
    ratchetIndex: index,
    revision: 1,
    rootKeyCiphertext: "root-key-ciphertext",
    rootKeyIv: "root-key-iv",
    rootKeyWrapperPublicKey: "root-key-wrapper-public-key",
    senderId: "user-1",
    senderName: "User",
    senderUsername: "user",
  };
}

beforeEach(() => {
  signedIn = true;
  allowed = true;
  backfillIds = [];
  sessions.clear();
  scopeRows = [
    {
      clearedAt: null,
      clearedThroughSequence: 0,
      conversationAvatarMediaId: null,
      conversationId: "conversation-1",
      conversationName: null,
      conversationType: "DM",
      coverageComplete: false,
      memberCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      memberLeftAt: null,
      membershipSequence: 1,
      peerAvatarUrl: null,
      peerName: "Ada",
      peerUsername: "ada",
      snapshotSequence: 10,
    },
  ];
  candidateRows = Array.from({ length: 21 }, (_, index) => candidate(index));
  delete process.env.MESSAGE_SEARCH_SERVER_ENABLED;
  delete process.env.MESSAGE_SEARCH_GLOBAL_ENABLED;
  delete process.env.MESSAGE_SEARCH_BACKFILL_ENABLED;
  mockGetSession.mockClear();
  mockRateLimit.mockClear();
  mockEnsureBackfills.mockClear();
  mockListScope.mockClear();
  mockSearchCandidates.mockClear();
  mockListDenEvents.mockClear();
});

describe("POST /api/messages/search/global", () => {
  test("requires an authenticated current-capability request", async () => {
    signedIn = false;
    const unauthenticated = await POST(request({ query: "needle" }));
    expect(unauthenticated.status).toBe(401);

    signedIn = true;
    const outdated = await POST(
      request({ query: "needle" }, { capability: false })
    );
    expect(outdated.status).toBe(426);
  });

  test("rejects short and malformed filters before opening a search scope", async () => {
    const short = await POST(request({ query: "x" }));
    expect(short.status).toBe(400);

    const invalidFilter = await POST(
      request({ conversationType: "PRIVATE", query: "needle" })
    );
    expect(invalidFilter.status).toBe(400);
    expect(mockListScope).not.toHaveBeenCalled();
  });

  test("returns a bounded page, signed continuation, and honest coverage", async () => {
    const response = await POST(
      request({ conversationType: "ALL", query: "needle" })
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.coverageComplete).toBe(false);
    expect(payload.coveragePaused).toBe(false);
    expect(payload.hasMore).toBe(true);
    expect(payload.nextCursor).toEqual(expect.any(String));
    expect(payload.sessionToken).toEqual(expect.any(String));
    expect(payload.hits).toHaveLength(20);
    expect(backfillIds).toEqual(["conversation-1"]);
    expect(mockSearchCandidates).toHaveBeenCalledTimes(1);

    const continuation = await POST(
      request({
        conversationType: "ALL",
        cursor: payload.nextCursor,
        query: "needle",
        sessionToken: payload.sessionToken,
      })
    );
    expect(continuation.status).toBe(200);
    expect(mockListScope).toHaveBeenCalledTimes(1);
    expect(mockSearchCandidates).toHaveBeenCalledTimes(2);
  });

  test("binds continuation to the original normalized query and filter", async () => {
    const first = await POST(
      request({ conversationType: "DM", query: "needle" })
    );
    const payload = (await first.json()) as Record<string, unknown>;
    const changedQuery = await POST(
      request({
        conversationType: "DM",
        query: "another needle",
        sessionToken: payload.sessionToken,
      })
    );
    const changedFilter = await POST(
      request({
        conversationType: "DEN",
        query: "needle",
        sessionToken: payload.sessionToken,
      })
    );

    expect(changedQuery.status).toBe(409);
    expect(changedFilter.status).toBe(409);
    expect(mockSearchCandidates).toHaveBeenCalledTimes(1);
  });

  test("honors the global-search rate limit", async () => {
    allowed = false;
    const response = await POST(request({ query: "needle" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(mockListScope).not.toHaveBeenCalled();
  });

  test("bounds account search sessions and allows evicted searches to restart", async () => {
    const first = await POST(request({ query: "needle" }));
    const payload = (await first.json()) as Record<string, unknown>;
    await Bun.sleep(2);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => POST(request({ query: "needle" })))
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect([...sessions.values()][0]?.size).toBe(4);
    const evicted = await POST(
      request({ query: "needle", sessionToken: payload.sessionToken })
    );
    expect(evicted.status).toBe(409);
    const newest = (await responses[3]?.json()) as Record<string, unknown>;
    const retained = await POST(
      request({ query: "needle", sessionToken: newest.sessionToken })
    );
    expect(retained.status).toBe(200);
  });

  test("rejects oversized streaming requests without a declared content length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        controller.enqueue(new Uint8Array(17 * 1024));
      },
    });
    const response = await POST(
      new Request("https://app.example/api/messages/search/global", {
        body,
        headers: { "X-Chat-Capability": "chat-lifecycle-v1" },
        method: "POST",
      })
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mockListScope).not.toHaveBeenCalled();
  });

  test("rejects a single hit that would exceed the response budget", async () => {
    candidateRows = [
      {
        ...candidate(0),
        ciphertext: "x".repeat(1_100_000),
      },
    ];

    const response = await POST(request({ query: "needle" }));
    const payload = (await response.json()) as { code?: string };

    expect(response.status).toBe(413);
    expect(payload.code).toBe("GLOBAL_SEARCH_PAGE_TOO_LARGE");
  });
});
