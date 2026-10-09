import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user-1" } }));
const mockGetConversation = mock(() => ({
  members: [
    {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      leftAt: null,
      userId: "user-1",
    },
  ],
  membershipSeq: 4,
  type: "DM",
}));
const mockRateLimit = mock(() =>
  Promise.resolve({
    allowed: true,
    remaining: 119,
    resetAt: 0,
    retryAfterSeconds: 0,
  })
);
const mockStartBackfill = mock(() =>
  Promise.resolve({
    completedAt: null,
    expectedPosition: { createdAt: null, messageId: null },
    throughSequence: 90,
  })
);
const mockEnqueueBackfill = mock(() => Promise.resolve());
const mockEnqueueCount = mock(() => Promise.resolve());
const mockRequestCount = mock((input: Record<string, unknown>) =>
  Promise.resolve({
    ...input,
    exactCount: null,
    id: "count-request-1",
    state: "pending",
    userId: "user-1",
  })
);
const mockListMembershipEvents = mock(() => Promise.resolve([]));
const mockSearchCandidates = mock(() => Promise.resolve([] as object[]));
const mockChangeSequence = mock(() => ({ changeSeq: 90 }));
const mockRecoveryState = mock(() => ({ recoveryGeneration: 2 }));
const mockCoverage = mock(() => ({
  artifactsCommitted: 100,
  completedChangeSeq: 89,
  rowsTraversed: 100,
  unrecoverableEpochs: 0,
}));
let candidateInput: Record<string, unknown> | undefined;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversation,
}));
const mockEpochCoverage = mock(() =>
  Promise.resolve({ pending: 0, unavailable: 0 })
);
mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  enqueueMessageSearchBackfill: mockEnqueueBackfill,
  enqueueMessageSearchCount: mockEnqueueCount,
  fromPrismaDateTime: (value: Date) => value,
  keys: { VIEWER_HASH_SECRET: "test-search-cursor-secret" },
  listDenMembershipEvents: mockListMembershipEvents,
  prisma: {
    orm: {
      public: {
        MessageConversations: {
          select: () => ({ where: () => ({ first: mockChangeSequence }) }),
        },
        MessageSearchAccountState: {
          select: () => ({ where: () => ({ first: mockRecoveryState }) }),
        },
        MessageSearchCoverage: { where: () => ({ first: mockCoverage }) },
      },
    },
  },
  readMessageSearchViewerEpochCoverage: mockEpochCoverage,
  requestMessageSearchCount: mockRequestCount,
  searchMessageCandidates: (input: Record<string, unknown>) => {
    candidateInput = input;
    return mockSearchCandidates();
  },
  startMessageSearchBackfill: mockStartBackfill,
}));

const reversePageCandidates = (start: number, count: number, step: number) =>
  Array.from({ length: count }, (_, index) => {
    const ordinal = start + index * step;
    return {
      createdAt: new Date(1_700_000_000_000 + ordinal * 1000),
      id: `message-${ordinal}`,
      keyEpoch: 1,
      ratchetIndex: ordinal,
      revision: 1,
      senderId: "user-1",
    };
  });

function request(
  body: unknown,
  options: { contentLength?: string; user?: boolean } = {}
): Request {
  if (options.user === false) {
    mockGetSession.mockReturnValueOnce(null);
  }
  return new Request("http://localhost/api/messages/conversations/c1/search", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(options.contentLength
        ? { "Content-Length": options.contentLength }
        : {}),
    },
    method: "POST",
  });
}

const context = { params: Promise.resolve({ id: "c1" }) };
describe("POST /api/messages/conversations/:id/search", () => {
  beforeEach(() => {
    mockEpochCoverage.mockReset();
    mockEpochCoverage.mockResolvedValue({ pending: 0, unavailable: 0 });
    process.env.MESSAGE_SEARCH_BACKFILL_ENABLED = "1";
    process.env.MESSAGE_SEARCH_COUNT_ENABLED = "1";
    process.env.MESSAGE_SEARCH_SERVER_ENABLED = "1";
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue({ user: { id: "user-1" } });
    mockGetConversation.mockReset();
    mockGetConversation.mockReturnValue({
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          leftAt: null,
          userId: "user-1",
        },
      ],
      membershipSeq: 4,
      type: "DM",
    });
    mockRateLimit.mockClear();
    mockStartBackfill.mockReset();
    mockStartBackfill.mockReturnValue(
      Promise.resolve({
        completedAt: null,
        expectedPosition: { createdAt: null, messageId: null },
        throughSequence: 90,
      })
    );
    mockEnqueueBackfill.mockClear();
    mockEnqueueCount.mockClear();
    mockRequestCount.mockReset();
    mockRequestCount.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        exactCount: null,
        id: "count-request-1",
        state: "pending",
        userId: "user-1",
      })
    );
    mockListMembershipEvents.mockClear();
    mockSearchCandidates.mockReset();
    mockSearchCandidates.mockReturnValue(Promise.resolve([]));
    mockChangeSequence.mockReturnValue({ changeSeq: 90 });
    mockRecoveryState.mockReturnValue({ recoveryGeneration: 2 });
    mockCoverage.mockReturnValue({
      artifactsCommitted: 100,
      backfillCompletedAt: null,
      completedChangeSeq: 89,
      rowsTraversed: 100,
      unrecoverableEpochs: 0,
    });
    candidateInput = undefined;
  });

  test("rejects missing sessions before reading the conversation", async () => {
    const response = await POST(
      request({ query: "needle" }, { user: false }),
      context
    );
    expect(response.status).toBe(401);
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  test("checks current conversation access before searching", async () => {
    mockGetConversation.mockReturnValueOnce(null);
    const response = await POST(request({ query: "needle" }), context);
    expect(response.status).toBe(404);
    expect(mockSearchCandidates).not.toHaveBeenCalled();
  });

  test("bounds bodies and applies the shared Unicode query contract", async () => {
    const oversized = await POST(
      request({ query: "needle" }, { contentLength: "20000" }),
      context
    );
    expect(oversized.status).toBe(413);
    const tooShort = await POST(request({ query: "😀" }), context);
    expect(tooShort.status).toBe(400);
    const tooLong = await POST(request({ query: "a".repeat(257) }), context);
    expect(tooLong.status).toBe(400);
    expect(mockSearchCandidates).not.toHaveBeenCalled();
  });

  test("returns bounded candidate metadata with honest incomplete coverage", async () => {
    mockSearchCandidates.mockReturnValueOnce(
      Promise.resolve([
        {
          ciphertext: "ciphertext",
          createdAt: new Date("2026-10-08T00:00:00.000Z"),
          id: "message-1",
          iv: "iv",
          keyEpoch: 1,
          ratchetIndex: 4,
          revision: 1,
          senderId: "user-1",
        },
      ])
    );
    const response = await POST(request({ query: "café" }), context);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      coverage: {
        complete: boolean;
        paused: boolean;
        settled: boolean;
        snapshotSequence: number;
      };
      hits: { ciphertext?: string; id: string; revision: number }[];
    };
    expect(body.coverage).toMatchObject({
      complete: false,
      paused: false,
      settled: false,
      snapshotSequence: 90,
    });
    expect(body.hits[0]).toMatchObject({ id: "message-1", revision: 1 });
    expect(body.hits[0]?.ciphertext).toBeUndefined();
    expect(mockStartBackfill).toHaveBeenCalledTimes(1);
    expect(mockEnqueueBackfill).toHaveBeenCalledWith("c1", null);
    expect(candidateInput).toMatchObject({
      conversationId: "c1",
      fragments: [{ grams: expect.any(Array), text: "cafe" }],
      limit: 21,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 90,
      userId: "user-1",
    });
  });

  test("marks incomplete coverage paused when the backfill kill switch is off", async () => {
    process.env.MESSAGE_SEARCH_BACKFILL_ENABLED = "0";
    const response = await POST(request({ query: "needle" }), context);
    const body = (await response.json()) as {
      coverage: { complete: boolean; paused: boolean; settled: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.coverage).toEqual({
      artifactsCommitted: 100,
      complete: false,
      completedChangeSequence: 89,
      paused: true,
      rowsTraversed: 100,
      settled: false,
      snapshotSequence: 90,
      unrecoverableEpochs: 0,
    });
    expect(mockStartBackfill).not.toHaveBeenCalled();
    expect(mockEnqueueBackfill).not.toHaveBeenCalled();
  });

  test("declares coverage complete only after the backfill and snapshot settle", async () => {
    mockStartBackfill.mockReturnValueOnce(
      Promise.resolve({
        completedAt: new Date("2026-10-08T00:01:00.000Z"),
        expectedPosition: {
          createdAt: new Date("2026-10-08T00:00:00.000Z"),
          messageId: "message-100",
        },
        throughSequence: 90,
      })
    );
    mockCoverage.mockReturnValueOnce({
      artifactsCommitted: 100,
      backfillCompletedAt: new Date("2026-10-08T00:01:00.000Z"),
      completedChangeSeq: 90,
      rowsTraversed: 100,
      unrecoverableEpochs: 0,
    });
    const response = await POST(request({ query: "needle" }), context);
    const body = (await response.json()) as {
      coverage: { complete: boolean; settled: boolean };
    };
    expect(body.coverage).toMatchObject({ complete: true, settled: true });
    expect(mockEnqueueBackfill).not.toHaveBeenCalled();
  });

  test("reports settled coverage without claiming completeness for unreadable history", async () => {
    mockStartBackfill.mockReturnValueOnce(
      Promise.resolve({
        completedAt: new Date("2026-10-08T00:01:00.000Z"),
        expectedPosition: { createdAt: null, messageId: null },
        throughSequence: 90,
      })
    );
    mockCoverage.mockReturnValueOnce({
      artifactsCommitted: 98,
      backfillCompletedAt: new Date("2026-10-08T00:01:00.000Z"),
      completedChangeSeq: 90,
      rowsTraversed: 100,
      unrecoverableEpochs: 2,
    });

    const response = await POST(request({ query: "needle" }), context);
    const body = (await response.json()) as {
      coverage: {
        complete: boolean;
        settled: boolean;
        unrecoverableEpochs: number;
      };
    };

    expect(body.coverage).toMatchObject({
      complete: false,
      settled: true,
      unrecoverableEpochs: 2,
    });
  });

  test("does not declare full coverage or queue exact counts before viewer epoch verification", async () => {
    mockCoverage.mockReturnValue({
      artifactsCommitted: 100,
      backfillCompletedAt: new Date(),
      completedChangeSeq: 90,
      rowsTraversed: 100,
      unrecoverableEpochs: 0,
    });
    mockEpochCoverage.mockResolvedValue({ pending: 1, unavailable: 0 });
    const response = await POST(request({ query: "needle" }), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coverage).toMatchObject({ complete: false, settled: false });
    expect(mockRequestCount).not.toHaveBeenCalled();
  });

  test("reports a verified unusable viewer epoch without a false complete scope", async () => {
    mockCoverage.mockReturnValue({
      artifactsCommitted: 100,
      backfillCompletedAt: new Date(),
      completedChangeSeq: 90,
      rowsTraversed: 100,
      unrecoverableEpochs: 0,
    });
    mockEpochCoverage.mockResolvedValue({ pending: 0, unavailable: 1 });
    const response = await POST(request({ query: "needle" }), context);
    const body = await response.json();
    expect(body.coverage).toMatchObject({
      complete: false,
      settled: true,
      unrecoverableEpochs: 1,
    });
  });

  test("creates a separately queued count only for a complete multi-page search", async () => {
    mockStartBackfill.mockReturnValueOnce(
      Promise.resolve({
        completedAt: new Date("2026-10-08T00:01:00.000Z"),
        expectedPosition: { createdAt: null, messageId: null },
        throughSequence: 90,
      })
    );
    mockCoverage.mockReturnValueOnce({
      artifactsCommitted: 100,
      backfillCompletedAt: new Date("2026-10-08T00:01:00.000Z"),
      completedChangeSeq: 90,
      rowsTraversed: 100,
      unrecoverableEpochs: 0,
    });
    mockSearchCandidates.mockReturnValueOnce(
      Promise.resolve(
        Array.from({ length: 21 }, (_, index) => ({
          ciphertext: "ciphertext",
          createdAt: new Date("2026-10-08T00:00:00.000Z"),
          id: `message-${index}`,
          iv: "iv",
          keyEpoch: 1,
          ratchetIndex: index,
          revision: 1,
          senderId: "user-1",
        }))
      )
    );
    const response = await POST(request({ query: "needle" }), context);
    const body = (await response.json()) as {
      countToken: string | null;
      hits: unknown[];
    };
    expect(body.hits).toHaveLength(20);
    expect(body.countToken).toBeString();
    expect(mockRequestCount).toHaveBeenCalledTimes(1);
    expect(mockEnqueueCount).toHaveBeenCalledWith("count-request-1");
  });

  test("pins later pages to the original snapshot and stable keyset", async () => {
    mockSearchCandidates.mockReturnValueOnce(
      Promise.resolve(
        Array.from({ length: 21 }, (_, index) => ({
          ciphertext: "ciphertext",
          createdAt: new Date(
            `2026-10-08T00:00:${String(21 - index).padStart(2, "0")}.000Z`
          ),
          id: `message-${index}`,
          iv: "iv",
          keyEpoch: 1,
          ratchetIndex: index,
          revision: 1,
          senderId: "user-1",
        }))
      )
    );
    const first = await POST(request({ query: "needle" }), context);
    const firstBody = (await first.json()) as {
      nextCursor: string | null;
      hits: unknown[];
    };
    expect(firstBody.hits).toHaveLength(20);
    expect(firstBody.nextCursor).toBeString();
    mockChangeSequence.mockReturnValueOnce({ changeSeq: 120 });
    await POST(
      request({ cursor: firstBody.nextCursor, query: "needle" }),
      context
    );
    expect(candidateInput).toMatchObject({
      before: {
        createdAt: expect.any(Date),
        messageId: "message-19",
      },
      snapshotSequence: 90,
    });
  });

  test("reverse cursors restore adjacent pages in newest-first order without retaining earlier hits", async () => {
    interface Page {
      hits: { id: string }[];
      nextCursor: string | null;
      previousCursor: string | null;
    }
    mockSearchCandidates.mockResolvedValueOnce(
      reversePageCandidates(61, 21, -1)
    );
    const headResponse = await POST(request({ query: "needle" }), context);
    const head: Page = await headResponse.json();
    expect(head.previousCursor).toBeNull();
    mockSearchCandidates.mockResolvedValueOnce(
      reversePageCandidates(41, 21, -1)
    );
    const secondResponse = await POST(
      request({ cursor: head.nextCursor, query: "needle" }),
      context
    );
    const second: Page = await secondResponse.json();
    mockSearchCandidates.mockResolvedValueOnce(
      reversePageCandidates(21, 21, -1)
    );
    const thirdResponse = await POST(
      request({ cursor: second.nextCursor, query: "needle" }),
      context
    );
    const third: Page = await thirdResponse.json();
    mockSearchCandidates.mockResolvedValueOnce(
      reversePageCandidates(22, 21, 1)
    );
    mockChangeSequence.mockReturnValueOnce({ changeSeq: 120 });
    const returnedResponse = await POST(
      request({ cursor: third.previousCursor, query: "needle" }),
      context
    );
    const returned: Page = await returnedResponse.json();
    expect(returned.hits).toEqual(second.hits);
    expect(returned.hits).toHaveLength(20);
    expect(returned.hits.some((hit) => hit.id === "message-42")).toBe(false);
    expect(candidateInput).toMatchObject({
      after: { createdAt: expect.any(Date), messageId: "message-21" },
      before: undefined,
      snapshotSequence: 90,
    });
    mockSearchCandidates.mockResolvedValueOnce(
      reversePageCandidates(42, 20, 1)
    );
    const returnedHeadResponse = await POST(
      request({ cursor: returned.previousCursor, query: "needle" }),
      context
    );
    const returnedHead: Page = await returnedHeadResponse.json();
    expect(returnedHead.hits).toEqual(head.hits);
    expect(returnedHead.previousCursor).toBeNull();
    expect(returnedHead.nextCursor).toBeString();
    expect(mockRequestCount).not.toHaveBeenCalled();
  });

  test("pins an incomplete first-page refresh to the initial search snapshot", async () => {
    const first = await POST(request({ query: "needle" }), context);
    const firstBody = (await first.json()) as { snapshotToken: string };
    expect(firstBody.snapshotToken).toBeString();

    mockChangeSequence.mockReturnValueOnce({ changeSeq: 120 });
    const refreshed = await POST(
      request({ query: "needle", snapshot: firstBody.snapshotToken }),
      context
    );

    expect(refreshed.status).toBe(200);
    expect(candidateInput).toMatchObject({ snapshotSequence: 90 });
    const refreshedBody = (await refreshed.json()) as {
      coverage: { snapshotSequence: number };
      snapshotToken: string;
    };
    expect(refreshedBody.coverage.snapshotSequence).toBe(90);
    expect(refreshedBody.snapshotToken).toBe(firstBody.snapshotToken);
  });

  test("rejects a first-page refresh after the recovery scope changes", async () => {
    const first = await POST(request({ query: "needle" }), context);
    const firstBody = (await first.json()) as { snapshotToken: string };
    mockRecoveryState.mockReturnValueOnce({ recoveryGeneration: 3 });

    const refreshed = await POST(
      request({ query: "needle", snapshot: firstBody.snapshotToken }),
      context
    );

    expect(refreshed.status).toBe(409);
    expect(mockSearchCandidates).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid and ambiguous page boundaries", async () => {
    const response = await POST(
      request({ cursor: "cursor", query: "needle", snapshot: "snapshot" }),
      context
    );
    expect(response.status).toBe(400);
    expect(mockSearchCandidates).not.toHaveBeenCalled();
  });

  test("rejects a cursor when permission scope changed", async () => {
    mockSearchCandidates.mockReturnValueOnce(
      Promise.resolve(
        Array.from({ length: 21 }, (_, index) => ({
          ciphertext: "ciphertext",
          createdAt: new Date("2026-10-08T00:00:00.000Z"),
          id: `message-${index}`,
          iv: "iv",
          keyEpoch: 1,
          ratchetIndex: index,
          revision: 1,
          senderId: "user-1",
        }))
      )
    );
    const first = await POST(request({ query: "needle" }), context);
    const firstBody = (await first.json()) as { nextCursor: string };
    mockRecoveryState.mockReturnValueOnce({ recoveryGeneration: 3 });
    const next = await POST(
      request({ cursor: firstBody.nextCursor, query: "needle" }),
      context
    );
    expect(next.status).toBe(409);
    expect(mockSearchCandidates).toHaveBeenCalledTimes(1);
  });

  test("rejects a cursor from a sequence beyond the current database snapshot", async () => {
    mockSearchCandidates.mockReturnValueOnce(
      Promise.resolve(
        Array.from({ length: 21 }, (_, index) => ({
          ciphertext: "ciphertext",
          createdAt: new Date("2026-10-08T00:00:00.000Z"),
          id: `message-${index}`,
          iv: "iv",
          keyEpoch: 1,
          ratchetIndex: index,
          revision: 1,
          senderId: "user-1",
        }))
      )
    );
    const first = await POST(request({ query: "needle" }), context);
    const firstBody = (await first.json()) as { nextCursor: string };
    mockChangeSequence.mockReturnValueOnce({ changeSeq: 80 });

    const next = await POST(
      request({ cursor: firstBody.nextCursor, query: "needle" }),
      context
    );

    expect(next.status).toBe(409);
    expect(mockSearchCandidates).toHaveBeenCalledTimes(1);
  });
});
