import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createMessageSearchCountToken } from "@/lib/messages/search-count-token";

import { POST } from "./route";

const secret = "count-route-test-secret";
const mockGetSession = mock(() => ({ user: { id: "user-1" } }));
const mockGetConversation = mock(() => ({
  members: [{ leftAt: null, userId: "user-1" }],
  membershipSeq: 4,
  type: "DM",
}));
const mockRateLimit = mock(() =>
  Promise.resolve({
    allowed: true,
    remaining: 29,
    resetAt: 0,
    retryAfterSeconds: 0,
  })
);
const mockSequence = mock(() => ({ changeSeq: 90 }));
const mockRecovery = mock(() => ({ recoveryGeneration: 2 }));
const mockCoverage = mock(() => ({
  backfillCompletedAt: new Date("2026-10-08T00:00:00.000Z"),
  completedChangeSeq: 90,
  unrecoverableEpochs: 0,
}));
const mockGetCount = mock(() =>
  Promise.resolve({
    conversationId: "conversation-1",
    exactCount: null,
    expiresAt: new Date(Date.now() + 60_000),
    id: "request-1",
    membershipSequence: 4,
    normalizationVersion: 1,
    queryHash: "query-hash",
    recoveryGeneration: 2,
    snapshotSequence: 90,
    state: "pending",
    userId: "user-1",
  })
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversation,
}));
mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  getMessageSearchCountRequestStatus: mockGetCount,
  keys: { VIEWER_HASH_SECRET: secret },
  prisma: {
    orm: {
      public: {
        MessageConversations: {
          select: () => ({ where: () => ({ first: mockSequence }) }),
        },
        MessageSearchAccountState: {
          select: () => ({ where: () => ({ first: mockRecovery }) }),
        },
        MessageSearchCoverage: {
          select: () => ({ where: () => ({ first: mockCoverage }) }),
        },
      },
    },
  },
}));

function createToken(): string {
  return createMessageSearchCountToken(
    {
      conversationId: "conversation-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      membershipSequence: 4,
      normalizationVersion: 1,
      queryHash: "query-hash",
      recoveryGeneration: 2,
      requestId: "request-1",
      snapshotSequence: 90,
      userId: "user-1",
    },
    secret
  );
}

function request(token: string, user = true): Request {
  if (!user) {
    mockGetSession.mockReturnValueOnce(null);
  }
  return new Request(
    "http://localhost/api/messages/conversations/conversation-1/search/count",
    {
      body: JSON.stringify({ token }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
}

const context = { params: Promise.resolve({ id: "conversation-1" }) };
describe("POST /api/messages/conversations/:id/search/count", () => {
  beforeEach(() => {
    process.env.MESSAGE_SEARCH_COUNT_ENABLED = "1";
    process.env.MESSAGE_SEARCH_SERVER_ENABLED = "1";
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue({ user: { id: "user-1" } });
    mockGetConversation.mockReset();
    mockGetConversation.mockReturnValue({
      members: [{ leftAt: null, userId: "user-1" }],
      membershipSeq: 4,
      type: "DM",
    });
    mockRateLimit.mockClear();
    mockSequence.mockReturnValue({ changeSeq: 90 });
    mockRecovery.mockReturnValue({ recoveryGeneration: 2 });
    mockCoverage.mockReturnValue({
      backfillCompletedAt: new Date("2026-10-08T00:00:00.000Z"),
      completedChangeSeq: 90,
      unrecoverableEpochs: 0,
    });
    mockGetCount.mockReset();
    mockGetCount.mockReturnValue(
      Promise.resolve({
        conversationId: "conversation-1",
        exactCount: null,
        expiresAt: new Date(Date.now() + 60_000),
        id: "request-1",
        membershipSequence: 4,
        normalizationVersion: 1,
        queryHash: "query-hash",
        recoveryGeneration: 2,
        snapshotSequence: 90,
        state: "pending",
        userId: "user-1",
      })
    );
  });

  test("requires an authenticated current conversation member", async () => {
    const response = await POST(request(createToken(), false), context);
    expect(response.status).toBe(401);
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  test("returns pending without exposing the query or count scope", async () => {
    const response = await POST(request(createToken()), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "pending" });
  });

  test("returns only a validated exact count", async () => {
    mockGetCount.mockReturnValueOnce(
      Promise.resolve({
        conversationId: "conversation-1",
        exactCount: 321,
        expiresAt: new Date(Date.now() + 60_000),
        id: "request-1",
        membershipSequence: 4,
        normalizationVersion: 1,
        queryHash: "query-hash",
        recoveryGeneration: 2,
        snapshotSequence: 90,
        state: "exact",
        userId: "user-1",
      })
    );
    const response = await POST(request(createToken()), context);
    expect(await response.json()).toEqual({ count: 321, state: "exact" });
  });

  test("invalidates counts after a recovery or source sequence change", async () => {
    mockSequence.mockReturnValueOnce({ changeSeq: 91 });
    const response = await POST(request(createToken()), context);
    expect(await response.json()).toEqual({ state: "unavailable" });
  });
});
