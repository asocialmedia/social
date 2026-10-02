import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_MESSAGE_HIDE_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
// Prisma 8: reads go through chainable orm queries and the batched insert is
// createAndCount, which resolves to the number of rows actually written.
const mockMessageRows = mock((): unknown[] => []);
const mockHiddenRows = mock((): unknown[] => []);
const mockCreateAndCount = mock((_rows: unknown) => 0);
let lastMessageQueryIds: string[] = [];
let _lastHiddenQueryIds: string[] = [];
const mockDecrement = mock((_userId: string, _count: number) => 0);
// Set to make the next insert lose a race, the way it would if a concurrent
// request had already inserted the same (messageId, userId) pair.
let loseNextInsert = false;
// A non-duplicate failure: the insert neither wins nor loses a race, it just
// breaks, while its siblings in the same batch stay committed.
let failNextInsert = false;

const READ_AT = new Date("2026-01-01T00:00:00.000Z");

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? {
          id: "convo-1",
          members: [
            { lastReadAt: READ_AT, userId: "user1" },
            { lastReadAt: null, userId: "user2" },
          ],
        }
      : null,
  parseJsonBody: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
}));

mock.module("@asm/db", () => ({
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  fromPrismaDateTime: (value: Date) => value,
  prisma: {
    orm: {
      public: {
        MessageHiddens: {
          // The route inserts one row at a time so it can tell which inserts
          // actually won, and credits the badge from those alone.
          create: (row: { messageId: string; userId: string }) => {
            if (failNextInsert) {
              failNextInsert = false;
              throw new Error("connection terminated unexpectedly");
            }
            if (loseNextInsert) {
              loseNextInsert = false;
              throw Object.assign(new Error("duplicate key"), {
                code: "23505",
              });
            }
            mockCreateAndCount([row]);
            return row;
          },
          createAndCount: (rows: { messageId: string; userId: string }[]) =>
            mockCreateAndCount(rows),
          select: () => ({
            where: (
              predicate: (hidden: {
                messageId: { in: (ids: string[]) => unknown };
                userId: { eq: (id: string) => unknown };
              }) => unknown
            ) => {
              let ids: string[] = [];
              predicate({
                messageId: {
                  in: (value: string[]) => {
                    ids = value;
                    return {};
                  },
                },
                userId: { eq: () => ({}) },
              } as never);
              _lastHiddenQueryIds = ids;
              return { all: () => mockHiddenRows() };
            },
          }),
        },
        Messages: {
          select: () => ({
            where: (
              predicate: (message: {
                conversationId: { eq: (id: string) => unknown };
                id: { in: (ids: string[]) => unknown };
              }) => unknown
            ) => {
              let _conversationId = "";
              let ids: string[] = [];
              predicate({
                conversationId: {
                  eq: (value: string) => {
                    _conversationId = value;
                    return {};
                  },
                },
                id: {
                  in: (value: string[]) => {
                    ids = value;
                    return {};
                  },
                },
              } as never);
              lastMessageQueryIds = ids;
              return { all: () => mockMessageRows() };
            },
          }),
        },
      },
    },
  },
  unreadMessageCache: { decrement: mockDecrement },
}));

function hideRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/messages/conversations/convo-1/hide",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
}

const params = { params: Promise.resolve({ id: "convo-1" }) };

describe("POST /api/messages/conversations/:id/hide", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockMessageRows.mockReset();
    mockMessageRows.mockImplementation(() => []);
    mockHiddenRows.mockReset();
    mockHiddenRows.mockImplementation(() => []);
    mockCreateAndCount.mockReset();
    failNextInsert = false;
    mockCreateAndCount.mockImplementation((rows: unknown) => rows.length);
    lastMessageQueryIds = [];
    _lastHiddenQueryIds = [];
    mockDecrement.mockReset();
    mockDecrement.mockImplementation(() => 0);
    limiter.reset();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(401);
  });

  test("404s for a non-member", async () => {
    mockGetSession.mockReturnValueOnce({ user: { id: "intruder" } });
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(404);
  });

  test("rejects an empty or non-array body", async () => {
    const empty = await POST(hideRequest({ messageIds: [] }), params);
    expect(empty.status).toBe(400);
    const notArray = await POST(hideRequest({ messageIds: "m1" }), params);
    expect(notArray.status).toBe(400);
    const missing = await POST(hideRequest({}), params);
    expect(missing.status).toBe(400);
  });

  test("rejects more than the batch cap", async () => {
    const res = await POST(
      hideRequest({
        messageIds: Array.from({ length: 101 }, (_, i) => `m${i}`),
      }),
      params
    );
    expect(res.status).toBe(400);
    expect(mockCreateAndCount).not.toHaveBeenCalled();
  });

  test("hides only rows that belong to the conversation", async () => {
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2025-12-31T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user1",
      },
    ]);
    const res = await POST(
      hideRequest({ messageIds: ["m1", "foreign-id", "m1"] }),
      params
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: 1 });
    // The query is scoped to the conversation and receives the deduped ids.
    expect(lastMessageQueryIds.toSorted()).toEqual(["foreign-id", "m1"]);
    expect(mockCreateAndCount).toHaveBeenCalledTimes(1);
  });

  test("credits the badge for newly hidden unread peer messages", async () => {
    mockMessageRows.mockReturnValueOnce([
      // Unread peer message, newer than the read watermark.
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
      // Own message: never counted.
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m2",
        senderId: "user1",
      },
      // Already read.
      {
        createdAt: new Date("2025-12-31T00:00:00.000Z"),
        deletedAt: null,
        id: "m3",
        senderId: "user2",
      },
      // Globally deleted: not counted.
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: new Date(),
        id: "m4",
        senderId: "user2",
      },
    ]);
    const res = await POST(
      hideRequest({ messageIds: ["m1", "m2", "m3", "m4"] }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockDecrement).toHaveBeenCalledWith("user1", 1);
  });

  test("does not re-credit an already-hidden message on a retry", async () => {
    // The message is still returned by the conversation-scoped lookup, but a
    // prior request already inserted its hide. The retry must neither insert
    // again nor decrement the badge, or the counter drifts low.
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
    ]);
    mockHiddenRows.mockReturnValueOnce([{ messageId: "m1" }]);
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: 0 });
    expect(mockCreateAndCount).not.toHaveBeenCalled();
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("credits only the not-yet-hidden unread messages in a mixed batch", async () => {
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m2",
        senderId: "user2",
      },
    ]);
    mockHiddenRows.mockReturnValueOnce([{ messageId: "m1" }]);
    const res = await POST(hideRequest({ messageIds: ["m1", "m2"] }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: 1 });
    expect(mockCreateAndCount).toHaveBeenCalledTimes(1);
    expect(mockDecrement).toHaveBeenCalledWith("user1", 1);
  });

  test("does not double-credit when a concurrent hide wins the insert", async () => {
    // Two requests hide the same unread message. Both read the already-hidden
    // set before either writes, so both classify it as newly hidden, but the
    // composite primary key lets only one insert through. The badge credit has
    // to follow the insert, not the intent, or the counter drops below the real
    // unread count.
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
    ]);
    loseNextInsert = true;
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: 0 });
    // The message is hidden, but this request did not hide it, so it must not
    // claim the badge credit.
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("keeps the hide successful when the badge credit fails", async () => {
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
    ]);
    mockDecrement.mockImplementationOnce(() => {
      throw new Error("redis down");
    });
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(200);
    expect(mockCreateAndCount).toHaveBeenCalledTimes(1);
  });

  test("returns zero without writing when nothing matches", async () => {
    mockMessageRows.mockReturnValueOnce([]);
    const res = await POST(hideRequest({ messageIds: ["ghost"] }), params);
    expect(await res.json()).toEqual({ hidden: 0 });
    expect(mockCreateAndCount).not.toHaveBeenCalled();
  });
});

describe("POST /api/messages/conversations/:id/hide partial failure", () => {
  // These are module-level mocks shared with the suite above, so reset them
  // here rather than inheriting the previous test's calls.
  beforeEach(() => {
    mockDecrement.mockReset();
    mockDecrement.mockImplementation(() => Promise.resolve());
    mockCreateAndCount.mockReset();
    mockCreateAndCount.mockImplementation((rows: unknown) =>
      Array.isArray(rows) ? rows.length : 0
    );
    failNextInsert = false;
    loseNextInsert = false;
  });

  test("credits the rows that committed before reporting the failure", () => {
    // Each insert is its own autocommit statement, so when one breaks the others
    // are already durable in the database. Bailing out on the first rejection
    // would skip the badge credit for those, leaving the counter counting
    // messages that are no longer unread.
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m2",
        senderId: "user2",
      },
    ]);
    failNextInsert = true;
    // The request still reports the failure, because one hide genuinely failed.
    // A throw here is what Next renders as a 500.
    expect(
      POST(hideRequest({ messageIds: ["m1", "m2"] }), params)
    ).rejects.toThrow("connection terminated unexpectedly");
    // ...but the row that did commit is credited, or the badge overcounts.
    expect(mockDecrement).toHaveBeenCalledTimes(1);
    expect(mockDecrement).toHaveBeenCalledWith("user1", 1);
  });

  test("credits nothing when the only failure happened before any commit", () => {
    // Guard against over-crediting: only rows that actually landed count.
    mockMessageRows.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
    ]);
    failNextInsert = true;
    expect(POST(hideRequest({ messageIds: ["m1"] }), params)).rejects.toThrow(
      "connection terminated unexpectedly"
    );
    expect(mockDecrement).not.toHaveBeenCalled();
  });
});

describe("POST /api/messages/conversations/:id/hide rate limit", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockMessageRows.mockReset();
    mockMessageRows.mockImplementation(() => []);
    mockHiddenRows.mockReset();
    mockHiddenRows.mockImplementation(() => []);
    mockCreateAndCount.mockReset();
    failNextInsert = false;
    mockCreateAndCount.mockImplementation((rows: unknown) => rows.length);
    lastMessageQueryIds = [];
    _lastHiddenQueryIds = [];
    mockDecrement.mockReset();
    mockDecrement.mockImplementation(() => 0);
    limiter.reset();
  });

  test("spends the hide budget, per account", async () => {
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_HIDE_RATE_LIMIT.bucket,
    ]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and inserts nothing when over budget", async () => {
    // One request here can be MAX_HIDE_BATCH inserts, so the refusal has to land
    // before the select that decides what would have been written.
    limiter.setDenied(true);
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockCreateAndCount).not.toHaveBeenCalled();
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("an oversized batch is still refused before it costs a query", async () => {
    // The route's own cap and the limiter answer different questions: the cap
    // bounds one request, the budget bounds how many requests. Both hold.
    const res = await POST(
      hideRequest({
        messageIds: Array.from({ length: 200 }, (_, i) => `m${i}`),
      }),
      params
    );
    expect(res.status).toBe(400);
    expect(mockCreateAndCount).not.toHaveBeenCalled();
  });
});
