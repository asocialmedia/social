import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET, POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockNextRatchetIndex = mock(() => 0);

const mockMessages: Record<string, unknown>[] = [];
const mockCreate = mock((args: Record<string, unknown>) => {
  const data =
    "data" in args && typeof args.data === "object" && args.data !== null
      ? (args.data as Record<string, unknown>)
      : args;
  const message = {
    id: "msg-1",
    sender: { id: "user1" },
    ...data,
  };
  mockMessages.push(message);
  return message;
});
const mockFindMany = mock(() => []);
const cursorTime = new Date("2026-10-10T00:00:00.000Z");
const mockCursor = mock(
  (id: string): { id: string; createdAt: Date } | null => ({
    createdAt: cursorTime,
    id,
  })
);
const mockMessageFirst = mock(() => mockMessages.at(-1) ?? null);
const mockIncrement = mock(() => 1);
const mockMessagePush = mock((_messageId: string, _recipientId: string) =>
  Promise.resolve()
);
const mockPublishCreated = mock(() => Promise.resolve());
const mockKeyFirst = mock(() => ({ ratchetCounter: 0 }));
const mockKeyUpdateAndCount = mock(() => 1);
const mockConversationUpdate = mock(() => ({}));
// Defaults to allowed so existing paging tests are unaffected; the budget tests
// below drive it directly.
const mockConsumeRateLimit = mock(() =>
  Promise.resolve({
    allowed: true,
    remaining: 100,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 60,
  })
);
const mockTransaction = mock((fn: (tx: unknown) => unknown) => fn(txClient));

// The peer's membership row, so a test can mark the chat muted on their side.
let peerMutedAt: Date | null = null;

// What the composed Prisma 8 read resolved to, so assertions can inspect the
// where/orderBy/limit the route actually built instead of Prisma 7 call args.
interface RecordedQuery {
  limit?: number;
  orderBy?: Record<string, string>;
  where: Record<string, unknown>;
}
let recorded: RecordedQuery = { where: {} };
let recordedQueries: RecordedQuery[] = [];

// Every comparison resolves to a column-keyed result, so the merged `and` output
// reads like a real filter: { id: { lte: "m-1" }, ... }.
const record = (column: string, op: string) => (value?: unknown) => ({
  [column]: { [op]: value },
});

// A minimal accessor that records which column each comparison ran against, in
// the Prisma 8 predicate shape (message.id.gt(cursor) etc).
function recordingAccessor() {
  return new Proxy(
    {},
    {
      get: (_target, column: string) => ({
        asc: () => `${column}:asc`,
        desc: () => `${column}:desc`,
        eq: record(column, "eq"),
        gt: record(column, "gt"),
        gte: record(column, "gte"),
        in: record(column, "in"),
        isNull: () => ({ [column]: { isNull: true } }),
        lt: record(column, "lt"),
        lte: record(column, "lte"),
        none: (predicate?: (accessor: unknown) => unknown) => ({
          [column]: predicate ? predicate(recordingAccessor()) : {},
        }),
        notIn: record(column, "notIn"),
      }),
    }
  );
}

function buildMessageQuery() {
  const state: RecordedQuery = { where: {} };
  const applyWhere = (
    filter: ((accessor: unknown) => unknown) | Record<string, unknown>
  ) => {
    // Prisma 8 accepts both a predicate callback and a plain filter object; the
    // route uses each in different places, so record whichever arrived.
    const built =
      typeof filter === "function" ? filter(recordingAccessor()) : filter;
    if (built && typeof built === "object") {
      Object.assign(state.where, built);
    }
    return query;
  };
  const query = {
    all: () => {
      recordedQueries.push(state);
      recorded = state;
      return mockFindMany();
    },
    cursor: () => query,
    first: () => {
      const id = (state.where.id as { eq?: string } | undefined)?.eq;
      return id && id !== "msg-1" ? mockCursor(id) : mockMessageFirst();
    },
    limit: (n: number) => {
      state.limit = n;
      return query;
    },
    orderBy: (
      predicate:
        | ((accessor: unknown) => unknown)
        | ((accessor: unknown) => unknown)[]
    ) => {
      const predicates = Array.isArray(predicate) ? predicate : [predicate];
      state.orderBy = Object.fromEntries(
        predicates.map((part) => String(part(recordingAccessor())).split(":"))
      );
      return query;
    },
    where: applyWhere,
  };
  return query;
}

const txClient = {
  message: { create: mockCreate },
  messageConversation: { update: mockConversationUpdate },
  messageConversationKey: { updateMany: mockKeyUpdateAndCount },
  orm: {
    public: {
      MessageConversationKeys: {
        // The CAS ratchet reads the newest epoch's counter, so the read chain
        // carries an orderBy on version before it resolves.
        select: () => {
          const keyQuery = {
            first: mockKeyFirst,
            orderBy: () => keyQuery,
          };
          return { where: () => keyQuery };
        },
        where: () => ({ updateAndCount: mockKeyUpdateAndCount }),
      },
      MessageConversations: {
        where: () => ({ update: mockConversationUpdate }),
      },
      Messages: { create: mockCreate },
    },
  },
};

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? {
          id: "convo-1",
          members: [
            { userId: "user1" },
            { mutedAt: peerMutedAt, userId: "user2" },
          ],
        }
      : null,
  messageSenderSelect: () => ({ sender: true }),
  nextRatchetIndex: mockNextRatchetIndex,
}));

mock.module("@asm/db", () => ({
  // The real `and` composes predicates into one expression; merging the
  // recorded column predicates into a flat object is what makes the composed
  // query inspectable.
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  consumeRateLimit: mockConsumeRateLimit,
  enqueueMessagePush: mockMessagePush,
  fromPrismaDateTime: (value: Date) => value,
  getMessageDataQuery: buildMessageQuery,
  or: (...conditions: unknown[]) => ({ $or: conditions }),
  prisma: {
    orm: {
      public: {
        MessageConversationKeys: {
          select: () => ({ where: () => ({ first: mockKeyFirst }) }),
          where: () => ({ updateAndCount: mockKeyUpdateAndCount }),
        },
        MessageConversations: {
          where: () => ({ update: mockConversationUpdate }),
        },
        Messages: { create: mockCreate },
      },
    },
    transaction: mockTransaction,
  },
  publishMessageCreated: mockPublishCreated,
  toPrismaDateTime: (value: Date) => value,
  unreadMessageCache: { increment: mockIncrement },
  visibleToUser:
    (userId: string) =>
    (message: {
      hiddenFor: {
        none: (predicate: (accessor: unknown) => unknown) => unknown;
      };
    }) => ({
      hiddenFor: message.hiddenFor.none((hidden) =>
        (hidden as { userId: { eq: (value: string) => unknown } }).userId.eq(
          userId
        )
      ),
    }),
}));

function convoUrl(path: string) {
  return `http://localhost:3000/api/messages/conversations/convo-1/${path}`;
}

function validPostRequest() {
  return new Request(convoUrl("messages"), {
    body: JSON.stringify({ ciphertext: "abc", iv: "def", ratchetIndex: 0 }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/messages/conversations/:id/messages", () => {
  beforeEach(() => {
    mockMessages.length = 0;
    mockCreate.mockClear();
    mockFindMany.mockClear();
    recordedQueries = [];
    recorded = { where: {} };
    mockIncrement.mockClear();
    mockMessagePush.mockClear();
    mockPublishCreated.mockClear();
    mockNextRatchetIndex.mockClear();
    mockKeyUpdateAndCount.mockClear();
    peerMutedAt = null;
    mockConversationUpdate.mockClear();
    mockTransaction.mockClear();
    mockGetSession.mockClear();
    mockConsumeRateLimit.mockClear();
    mockConsumeRateLimit.mockImplementation(() =>
      Promise.resolve({
        allowed: true,
        remaining: 100,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
      })
    );
    mockNextRatchetIndex.mockReturnValue(0);
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(txClient)
    );
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(401);
  });

  test("does not accrue unread for a peer who muted the chat", async () => {
    // A mute exists so the badge stays off, and the unread seed excludes muted
    // memberships, so incrementing here would grow a counter the seed would
    // never justify.
    peerMutedAt = new Date("2026-01-01T00:00:00.000Z");
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockIncrement).not.toHaveBeenCalled();
    expect(mockMessagePush).not.toHaveBeenCalled();
  });

  test("still accrues unread for a peer who has not muted", async () => {
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockIncrement).toHaveBeenCalledWith("user2");
    expect(mockMessagePush).toHaveBeenCalledWith("msg-1", "user2");
  });

  test("a push queue outage does not fail a committed message", async () => {
    mockMessagePush.mockRejectedValueOnce(new Error("Queue unavailable"));
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid ciphertext payloads", async () => {
    const res = await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({ iv: "abc" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(400);
  });

  test("rejects an oversized ciphertext with 413", async () => {
    const res = await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({
          ciphertext: "x".repeat(100_001),
          iv: "def",
          ratchetIndex: 0,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(413);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("rejects a stale ratchet index with 409 and the expected value", async () => {
    mockNextRatchetIndex.mockReturnValueOnce(4);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { expectedIndex: number };
    expect(body.expectedIndex).toBe(4);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("blocks sends after either party blocks", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("stores the server-authoritative ratchet index and notifies the peer", async () => {
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0]?.[0] as {
      conversationId: string;
      ratchetIndex: number;
      senderId: string;
    };
    expect(createArgs.conversationId).toBe("convo-1");
    expect(createArgs.ratchetIndex).toBe(0);
    expect(createArgs.senderId).toBe("user1");
    expect(mockKeyUpdateAndCount).toHaveBeenCalledWith({
      ratchetCounter: 1,
    });
    expect(mockConversationUpdate).toHaveBeenCalledWith({
      updatedAt: expect.any(Date),
    });
    // The peer accrues unread; the sender does not.
    expect(mockIncrement).toHaveBeenCalledWith("user2");
    expect(mockPublishCreated).toHaveBeenCalledTimes(1);
  });

  test("keeps a committed send successful when redis side effects fail", async () => {
    mockIncrement.mockImplementationOnce(() => {
      throw new Error("redis down");
    });
    mockPublishCreated.mockImplementationOnce(() =>
      Promise.reject(new Error("publish down"))
    );
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test("returns 409 with a fresh index when the unique constraint rejects the create", async () => {
    mockTransaction.mockImplementationOnce(() => {
      throw Object.assign(new Error("unique constraint"), { code: "P2002" });
    });
    mockNextRatchetIndex.mockReturnValueOnce(1);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { expectedIndex: number };
    expect(body.expectedIndex).toBe(1);
  });
});

describe("GET /api/messages/conversations/:id/messages", () => {
  beforeEach(() => {
    mockCursor.mockImplementation((id) => ({ createdAt: cursorTime, id }));
    mockFindMany.mockClear();
    recordedQueries = [];
    recorded = { where: {} };
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockConsumeRateLimit.mockClear();
    mockConsumeRateLimit.mockImplementation(() =>
      Promise.resolve({
        allowed: true,
        remaining: 100,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
      })
    );
  });

  test("returns the page and a cursor for older messages", async () => {
    mockFindMany.mockReturnValueOnce([
      { id: "newer" },
      { id: "older" },
      { id: "oldest" },
    ]);
    const res = await GET(new Request(convoUrl("messages")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    const body = (await res.json()) as {
      messages: { id: string }[];
      previousCursor: string | null;
    };
    // Newest-first on the wire, oldest-first in the payload.
    expect(body.messages.map((m) => m.id)).toEqual([
      "oldest",
      "older",
      "newer",
    ]);
    expect(body.previousCursor).toBeNull();
  });

  test("caps a page at PAGE_SIZE and reports hasMore via previousCursor", async () => {
    // PAGE_SIZE + 1 rows -> one is withheld and the last visible row becomes
    // the previous cursor.
    const rows = Array.from({ length: 31 }, (_, index) => ({
      id: `m-${String(index).padStart(3, "0")}`,
    }));
    mockFindMany.mockReturnValueOnce(rows);
    const res = await GET(new Request(convoUrl("messages")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    const body = (await res.json()) as {
      messages: { id: string }[];
      previousCursor: string | null;
    };
    expect(body.messages).toHaveLength(30);
    // The 30th (last) visible row becomes the cursor for the previous page.
    expect(body.previousCursor).toBe("m-029");
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test("seeks with a timestamp and ID rather than the random UUID alone", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "m-010" }]);
    const req = new Request(convoUrl("messages?cursor=m-020"), {
      method: "GET",
    });
    await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test("honors a valid limit for faster history walks", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "m-001" }]);
    const req = new Request(convoUrl("messages?limit=100"), { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(res.status).toBe(200);
    expect(recorded.limit).toBe(101);
  });

  test("clamps an oversized limit to the server maximum", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "m-001" }]);
    const req = new Request(convoUrl("messages?limit=10000"), {
      method: "GET",
    });
    await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(recorded.limit).toBe(101);
  });

  test("ignores a non-numeric limit and falls back to the default page", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "m-001" }]);
    const req = new Request(convoUrl("messages?limit=lots"), { method: "GET" });
    await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(recorded.limit).toBe(31);
  });

  test("rejects an ambiguous request naming two paging axes", async () => {
    const req = new Request(convoUrl("messages?cursor=m-1&around=m-2"), {
      method: "GET",
    });
    const res = await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test("anchored read returns a window centered on the target with both cursors", async () => {
    // limit 4 => 2 older (inclusive of the anchor) + 2 newer.
    mockFindMany
      // Older half, newest-first as queried.
      .mockReturnValueOnce([{ id: "m-20" }, { id: "m-19" }, { id: "m-18" }])
      // Newer half, oldest-first as queried.
      .mockReturnValueOnce([{ id: "m-22" }, { id: "m-23" }, { id: "m-24" }]);
    const req = new Request(convoUrl("messages?around=m-20&limit=4"), {
      method: "GET",
    });
    const res = await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    const body = (await res.json()) as {
      anchorIndex: number;
      messages: { id: string }[];
      nextCursor: string | null;
      previousCursor: string | null;
    };
    // Oldest-first overall, which is the order the transcript renders in.
    expect(body.messages.map((m) => m.id)).toEqual([
      "m-19",
      "m-20",
      "m-22",
      "m-23",
    ]);
    expect(body.anchorIndex).toBe(1);
    // An extra row on each side meant "there is more", so both cursors are set
    // to the oldest / newest message actually returned.
    expect(body.previousCursor).toBe("m-19");
    expect(body.nextCursor).toBe("m-23");
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  test("anchored read reports anchorIndex -1 when the target is not visible", async () => {
    // Deleted or hidden-for-me target: the server still returns the nearest
    // older window rather than failing, and says the anchor is not in it.
    mockFindMany
      .mockReturnValueOnce([{ id: "m-09" }, { id: "m-08" }])
      .mockReturnValueOnce([]);
    const req = new Request(convoUrl("messages?around=m-10"), {
      method: "GET",
    });
    const res = await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    const body = (await res.json()) as {
      anchorIndex: number;
      nextCursor: string | null;
      previousCursor: string | null;
    };
    expect(res.status).toBe(200);
    expect(body.anchorIndex).toBe(-1);
    // Only 2 rows on the older side and no probe row, so there is nothing older.
    expect(body.previousCursor).toBeNull();
    expect(body.nextCursor).toBeNull();
  });

  test("anchored read splits the page with the larger half older", async () => {
    mockFindMany.mockReturnValueOnce([]).mockReturnValueOnce([]);
    await GET(
      new Request(convoUrl("messages?around=m-1&limit=7"), { method: "GET" }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    const [olderQuery, newerQuery] = recordedQueries;
    // Odd page: 4 older + 3 newer, each with one probe row.
    expect(olderQuery?.limit).toBe(5);
    expect(newerQuery?.limit).toBe(4);
    expect(olderQuery?.orderBy).toEqual({ createdAt: "desc", id: "desc" });
    expect(newerQuery?.orderBy).toEqual({ createdAt: "asc", id: "asc" });
    expect(olderQuery?.where.$or).toEqual([
      { createdAt: { lt: cursorTime } },
      { createdAt: { eq: cursorTime }, id: { lte: "m-1" } },
    ]);
    expect(newerQuery?.where.$or).toEqual([
      { createdAt: { gt: cursorTime } },
      { createdAt: { eq: cursorTime }, id: { gt: "m-1" } },
    ]);
  });

  test("anchored read excludes messages hidden for the caller", async () => {
    mockFindMany.mockReturnValueOnce([]).mockReturnValueOnce([]);
    await GET(new Request(convoUrl("messages?around=m-1"), { method: "GET" }), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    // Every read the anchored window issues must carry the hidden-message
    // filter, so a "delete for me" never reappears in this user's transcript.
    for (const query of recordedQueries) {
      expect(query.where.hiddenFor).toEqual({
        hiddenFor: { userId: { eq: "user1" } },
      });
    }
  });

  test("newer paging reads ascending and reports a next cursor", async () => {
    mockFindMany.mockReturnValueOnce([
      { id: "m-31" },
      { id: "m-32" },
      { id: "m-33" },
    ]);
    const req = new Request(convoUrl("messages?after=m-30&limit=2"), {
      method: "GET",
    });
    const res = await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    const body = (await res.json()) as {
      messages: { id: string }[];
      nextCursor: string | null;
      previousCursor: string | null;
    };
    // Already oldest-first, so no reversal here.
    expect(body.messages.map((m) => m.id)).toEqual(["m-31", "m-32"]);
    expect(body.nextCursor).toBe("m-32");
    // Growth older from the window's edge is always offered, so the transcript
    // auto-loader can keep paging down.
    expect(body.previousCursor).toBe("m-31");
    expect(recorded.orderBy?.id).toBe("asc");
    expect(recorded.orderBy?.createdAt).toBe("asc");
    expect(recorded.where.$or).toEqual([
      { createdAt: { gt: cursorTime } },
      { createdAt: { eq: cursorTime }, id: { gt: "m-30" } },
    ]);
  });

  test("newer paging reports no next cursor on the last page", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "m-99" }]);
    const req = new Request(convoUrl("messages?after=m-98"), { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    const body = (await res.json()) as { nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
  });
});

describe("history request budgets", () => {
  beforeEach(() => {
    mockFindMany.mockClear();
    recordedQueries = [];
    recorded = { where: {} };
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockConsumeRateLimit.mockClear();
    mockConsumeRateLimit.mockImplementation(() =>
      Promise.resolve({
        allowed: true,
        remaining: 100,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
      })
    );
  });

  function deny() {
    mockConsumeRateLimit.mockImplementation(() =>
      Promise.resolve({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
        retryAfterSeconds: 30,
      })
    );
  }

  test("a plain newest read is not metered at all", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "newer" }]);
    await GET(new Request(convoUrl("messages")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    // Opening a thread must never be throttled: it is the one read a user
    // cannot avoid.
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });

  test("an anchored jump is not metered", async () => {
    mockFindMany.mockReturnValueOnce([]);
    await GET(new Request(convoUrl("messages?around=m-9")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });

  test("a cursor page is metered under the general paging budget", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "older" }]);
    await GET(new Request(convoUrl("messages?cursor=m-9")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    const call = mockConsumeRateLimit.mock.calls[0]?.[0] as {
      bucket: string;
      limit: number;
    };
    expect(call.bucket).toBe("messages-page");
    // Higher than the walk budget: a client that omits walk=1 must not be
    // penalised relative to one that declares itself.
    expect(call.limit).toBeGreaterThanOrEqual(600);
  });

  // The walk flag is client-supplied, so the general ceiling above is the real
  // control; this is the tighter budget for a client that tells the truth.
  test("a declared history walk is metered under the tighter walk budget", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "older" }]);
    await GET(new Request(convoUrl("messages?cursor=m-9&walk=1")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    const call = mockConsumeRateLimit.mock.calls[0]?.[0] as {
      bucket: string;
      limit: number;
      windowSeconds: number;
    };
    expect(call.bucket).toBe("messages-history-walk");
    // Must exceed the 240 pages/minute a 250ms-paced walk generates, or the
    // limiter throttles the client it is meant to protect: a 30/min budget
    // stopped a walk after 7 seconds and 30 pages.
    expect(call.limit).toBeGreaterThanOrEqual(400);
    expect(call.windowSeconds).toBe(60);
  });

  test("the walk budget is keyed per user", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "older" }]);
    await GET(new Request(convoUrl("messages?cursor=m-9&walk=1")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    const call = mockConsumeRateLimit.mock.calls[0]?.[0] as {
      identifier: string;
    };
    expect(call.identifier).toBe("user1");
  });

  test("a rejected walk is 429 and never reaches the database", async () => {
    deny();
    const res = await GET(new Request(convoUrl("messages?cursor=m-9&walk=1")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(429);
    // Metered before the query, so a throttled walk costs nothing.
    expect(mockFindMany).not.toHaveBeenCalled();
    const body = (await res.json()) as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(30);
  });

  test("a rejected cursor page is 429 too", async () => {
    deny();
    const res = await GET(new Request(convoUrl("messages?cursor=m-9")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(429);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test("an unauthenticated read is rejected before any metering", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET(new Request(convoUrl("messages?cursor=m-9&walk=1")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(401);
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });
});

test("missing cursor is rejected instead of returning an unrelated UUID window", async () => {
  mockCursor.mockImplementationOnce(() => null);
  const response = await GET(new Request(convoUrl("messages?cursor=missing")), {
    params: Promise.resolve({ id: "convo-1" }),
  });
  expect(response.status).toBe(404);
});
