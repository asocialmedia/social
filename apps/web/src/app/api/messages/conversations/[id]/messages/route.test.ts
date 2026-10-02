import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

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
const mockMessageFirst = mock(() => mockMessages.at(-1) ?? null);
const mockIncrement = mock(() => 1);
// The send path's single badge write. A list rather than a count because the
// question under test is WHICH members move, and a count cannot answer it.
const mockIncrementMany = mock((_userIds: readonly string[]) =>
  Promise.resolve()
);

// Everyone the send actually credited with an unread badge, across every call.
// Flattened rather than asserted per call so a test states the outcome ("these
// members accrue a badge") instead of the shape of the call that produces it -
// which is what lets the route move from one INCRBY per member to one pipelined
// write without touching a single assertion here.
function unreadRecipients(): string[] {
  return mockIncrementMany.mock.calls.flatMap((call) => [...call[0]]);
}
const mockPublishCreated = mock(() => Promise.resolve());
const mockPublishActivity = mock(() => Promise.resolve());
const mockKeyFirst = mock(() => ({ ratchetCounter: 0 }));
const mockKeyUpdateAndCount = mock(() => 1);
const mockConversationUpdate = mock(() => ({}));
// The queue. Every created notification is enqueued by its own id, so the
// calls are the fan-out's report to the worker.
const mockEnqueueNotificationCreated = mock(() => Promise.resolve());
// Failure injection, as flags rather than queued implementations: a queued
// implementation survives a mockClear, so one test's failure would leak into the
// next one's send.
let enqueueFailure: Error | null = null;
let transactionFailure: Error | null = null;
let denFanOutFailure: Error | null = null;
// The den fan-out's own reads, its mute filter and its fold are covered against
// a live database in packages/db/src/messages/den-notifications.integration.test.ts.
// Here it stands in for the layer that decides the audience, so these tests can
// pin the route's half: that the route enqueues exactly what the fan-out
// reported, and that a member the fan-out skipped is skipped by the enqueue too.
const mockCreateDenMessageNotifications = mock(() =>
  Promise.resolve([] as { id: string; recipientId: string }[])
);
// Den members, with the mute a test can set. The fan-out mock honours the same
// rule the real one does: not the sender, and nobody muted.
let denMembers: { mutedAt: Date | null; userId: string }[] = [];
mockCreateDenMessageNotifications.mockImplementation(
  (_tx: unknown, input: { conversationId: string; senderId: string }) => {
    if (denFanOutFailure) {
      throw denFanOutFailure;
    }
    return denMembers
      .filter(
        (member) => member.userId !== input.senderId && member.mutedAt === null
      )
      .map((member, index) => ({
        id: `notif-${index + 1}`,
        recipientId: member.userId,
      }));
  }
);
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
    first: () => mockMessageFirst(),
    limit: (n: number) => {
      state.limit = n;
      return query;
    },
    orderBy: (predicate: (accessor: unknown) => unknown) => {
      const built = predicate(recordingAccessor());
      if (typeof built === "string") {
        const [column, direction] = built.split(":");
        state.orderBy = { [column ?? ""]: direction ?? "asc" };
      } else if (Array.isArray(built)) {
        state.orderBy = Object.fromEntries(
          built.filter((entry) => typeof entry === "string")
        );
      }
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
  getConversationForUser: (conversationId: string, userId: string) => {
    if (userId !== "user1") {
      return null;
    }
    if (conversationId === "den-1") {
      return {
        id: "den-1",
        members: [{ mutedAt: null, userId: "user1" }, ...denMembers],
        type: "DEN",
      };
    }
    return conversationId === "convo-1"
      ? {
          id: "convo-1",
          members: [
            { userId: "user1" },
            { mutedAt: peerMutedAt, userId: "user2" },
          ],
          type: "DM",
        }
      : null;
  },
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
  createDenMessageNotifications: mockCreateDenMessageNotifications,
  enqueueNotificationCreated: mockEnqueueNotificationCreated,
  enqueueNotificationDeleted: mock(() => Promise.resolve()),
  fromPrismaDateTime: (value: Date) => value,
  getMessageDataQuery: buildMessageQuery,
  or: (...conditions: unknown[]) => conditions,
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
  publishMessageActivity: mockPublishActivity,
  publishMessageCreated: mockPublishCreated,
  toPrismaDateTime: (value: Date) => value,
  unreadMessageCache: {
    increment: mockIncrement,
    incrementMany: mockIncrementMany,
  },
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

function denUrl() {
  return "http://localhost:3000/api/messages/conversations/den-1/messages";
}

function validPostRequest(url = convoUrl("messages")) {
  return new Request(url, {
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
    mockIncrementMany.mockClear();
    mockIncrementMany.mockImplementation(() => Promise.resolve());
    mockPublishCreated.mockClear();
    mockPublishActivity.mockClear();
    mockEnqueueNotificationCreated.mockClear();
    mockCreateDenMessageNotifications.mockClear();
    // mockReset, not mockClear: a queued one-shot survives a clear, and a test
    // that returns before reaching its queued value would leak it forward.
    mockNextRatchetIndex.mockReset();
    mockKeyUpdateAndCount.mockClear();
    peerMutedAt = null;
    denMembers = [
      { mutedAt: null, userId: "user2" },
      { mutedAt: null, userId: "user3" },
    ];
    mockConversationUpdate.mockClear();
    mockTransaction.mockReset();
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
    mockEnqueueNotificationCreated.mockImplementation(() => Promise.resolve());
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
    expect(unreadRecipients()).toEqual([]);
  });

  test("still accrues unread for a peer who has not muted", async () => {
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    // The peer, and not the sender: a member reads their own messages, and the
    // read route's decrement counts only peer-authored rows, so the two halves
    // have to agree about who that is.
    expect(unreadRecipients()).toEqual(["user2"]);
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
    // The conversation bump writes the timestamp and NOTHING ELSE. A send is not
    // a roster change, so the roster counter must not move here: if it did, every
    // message in every den would read to a client as a membership event and cost
    // every member a conversation-detail refetch.
    expect(mockConversationUpdate).toHaveBeenCalledWith({
      updatedAt: expect.any(Date),
    });
    // The peer accrues unread; the sender does not.
    expect(unreadRecipients()).toEqual(["user2"]);
    expect(mockPublishCreated).toHaveBeenCalledTimes(1);
  });

  test("echoes the conversation's roster counter alongside the message", async () => {
    // The one response a member whose `den.membership.changed` was lost will ever
    // see: pub/sub is best-effort, so the send is how they discover their cached
    // roster is behind. The value comes out of the UPDATE's own RETURNING, inside
    // the transaction that bumped the row, so it cannot be stale by the time the
    // response is written.
    mockConversationUpdate.mockImplementationOnce(() => ({
      membershipSeq: 7,
    }));
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      membershipSeq: number | null;
      message: { id: string };
    };
    expect(body.membershipSeq).toBe(7);
    // A sibling of `message`, not a field on it: the counter describes the
    // conversation, so `mapMessage` stays a mapper of a message row.
    expect(body.message.id).toBe(mockMessages.at(-1)?.id);
    expect(body.message).not.toHaveProperty("membershipSeq");
  });

  test("reports no counter when the bump returned no row", async () => {
    // The graceful half. A server that has not shipped the column, or a
    // transaction that somehow updated nothing, answers null, and the client reads
    // that as "cannot tell" and behaves exactly as it did before this field
    // existed. Never a crash, and never an invented number.
    mockConversationUpdate.mockImplementationOnce(() => {});
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { membershipSeq: number | null };
    expect(body.membershipSeq).toBeNull();
  });

  test("keeps a committed send successful when redis side effects fail", async () => {
    mockIncrementMany.mockImplementationOnce(() => {
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

describe("POST to a den fans a notification out to the members", () => {
  beforeEach(() => {
    mockMessages.length = 0;
    mockCreate.mockClear();
    mockIncrement.mockClear();
    mockIncrementMany.mockClear();
    mockIncrementMany.mockImplementation(() => Promise.resolve());
    mockPublishCreated.mockClear();
    mockPublishActivity.mockClear();
    mockEnqueueNotificationCreated.mockClear();
    mockCreateDenMessageNotifications.mockClear();
    mockNextRatchetIndex.mockReset();
    mockKeyUpdateAndCount.mockClear();
    mockConversationUpdate.mockClear();
    mockTransaction.mockReset();
    mockGetSession.mockClear();
    peerMutedAt = null;
    denMembers = [
      { mutedAt: null, userId: "user2" },
      { mutedAt: null, userId: "user3" },
    ];
    enqueueFailure = null;
    transactionFailure = null;
    denFanOutFailure = null;
    mockEnqueueNotificationCreated.mockImplementation(() =>
      enqueueFailure ? Promise.reject(enqueueFailure) : Promise.resolve()
    );
    mockNextRatchetIndex.mockReturnValue(0);
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      transactionFailure ? Promise.reject(transactionFailure) : fn(txClient)
    );
  });

  test("enqueues one notification per member, never the sender", async () => {
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    // The audience is the fan-out's report, so the sender is not in it.
    expect(mockCreateDenMessageNotifications).toHaveBeenCalledTimes(1);
    expect(mockEnqueueNotificationCreated.mock.calls).toEqual([
      ["user2", "notif-1"],
      ["user3", "notif-2"],
    ]);
    expect(
      mockEnqueueNotificationCreated.mock.calls.some(
        (call) => call[0] === "user1"
      )
    ).toBe(false);
  });

  test("enqueues nothing for a member the fan-out skipped, and still delivers the message to everyone", async () => {
    // A mute is why the fan-out skips a member; the mute itself is pinned
    // against a live database in den-notifications.integration.test.ts. What is
    // pinned here is that a skipped member cannot slip past the enqueue, and
    // that skipping them costs them nothing in the thread.
    denMembers = [
      { mutedAt: null, userId: "user2" },
      { mutedAt: new Date("2026-01-01T00:00:00.000Z"), userId: "user3" },
    ];
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockEnqueueNotificationCreated.mock.calls).toEqual([
      ["user2", "notif-1"],
    ]);
    // The message is stored, published to the thread, and every member's
    // conversation list is told about it - the muted member included.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockPublishCreated).toHaveBeenCalledTimes(1);
    expect(
      mockPublishActivity.mock.calls.map((call) => call[0]).toSorted()
    ).toEqual(["user1", "user2", "user3"]);
  });

  test("a DM send fans nothing out", async () => {
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    // A DM has no notification for a new message, so the den fan-out is not
    // even asked for one. A den behaving differently here would be a surprise
    // rather than a feature.
    expect(mockCreateDenMessageNotifications).not.toHaveBeenCalled();
    expect(mockEnqueueNotificationCreated).not.toHaveBeenCalled();
  });

  test("a rolled back send enqueues nothing", async () => {
    transactionFailure = new Error("the send failed");
    await expect(
      POST(validPostRequest(denUrl()), {
        params: Promise.resolve({ id: "den-1" }),
      })
    ).rejects.toThrow("the send failed");
    // Nothing committed, so nothing is announced. The rows the fan-out wrote
    // rolled back with the message inside the same transaction, and the enqueue
    // that follows the commit never ran.
    expect(mockEnqueueNotificationCreated).not.toHaveBeenCalled();
  });

  test("a queue failure does not fail the send", async () => {
    enqueueFailure = new Error("redis down");
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    // The message is stored and committed by the time the fan-out is
    // announced, so a queue outage costs a badge and a push, never the send.
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // The enqueue is attempted, and retried, rather than skipped.
    await Bun.sleep(400);
    expect(mockEnqueueNotificationCreated.mock.calls.length).toBeGreaterThan(1);
  });

  test("a fan-out failure inside the transaction fails the send", async () => {
    // The other side of the rule above, and the reason the rows are written
    // inside the message's own transaction: a fan-out that cannot record its
    // rows rolls the message back rather than committing a message that nobody
    // will be told about.
    denFanOutFailure = new Error("fan-out down");
    await expect(
      POST(validPostRequest(denUrl()), {
        params: Promise.resolve({ id: "den-1" }),
      })
    ).rejects.toThrow("fan-out down");
    expect(mockEnqueueNotificationCreated).not.toHaveBeenCalled();
  });
});

describe("a send accrues unread for every member it reaches", () => {
  // The badge is one Redis counter per user across every conversation they are
  // in, incremented on send and decremented on read by the number of rows the
  // read's own filter counts. So the only shape that nets to zero is "one
  // increment per member, per message, for exactly the members the read counts
  // for that member".
  //
  // The bug this pins: the send path incremented ONE member - the first
  // membership row that was not the sender's - which is correct for a DM and
  // catastrophic for a den. Ninety-eight of ninety-nine members got no badge,
  // and which one did was whatever order the roster came back in. There is no
  // test below that a two-member DM would have caught, because in a DM the one
  // member IS the peer.

  beforeEach(() => {
    mockMessages.length = 0;
    mockCreate.mockClear();
    mockIncrement.mockClear();
    mockIncrementMany.mockClear();
    mockIncrementMany.mockImplementation(() => Promise.resolve());
    mockPublishCreated.mockClear();
    mockPublishActivity.mockClear();
    mockEnqueueNotificationCreated.mockClear();
    mockCreateDenMessageNotifications.mockClear();
    mockNextRatchetIndex.mockReset();
    mockNextRatchetIndex.mockReturnValue(0);
    mockKeyUpdateAndCount.mockClear();
    mockConversationUpdate.mockClear();
    mockGetSession.mockClear();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(txClient)
    );
    enqueueFailure = null;
    transactionFailure = null;
    denFanOutFailure = null;
    mockEnqueueNotificationCreated.mockImplementation(() => Promise.resolve());
    denMembers = [
      { mutedAt: null, userId: "user2" },
      { mutedAt: null, userId: "user3" },
    ];
  });

  test("a three-member den badges both of the other members", async () => {
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    // The roster is user1 (sender), user2, user3. Both readers, neither the
    // sender, and the order they are named in is the roster's, not a pick.
    expect(unreadRecipients()).toEqual(["user2", "user3"]);
  });

  test("a muted member is skipped and the rest still move", async () => {
    // A mute is why the unread seed excludes the membership entirely, so a
    // muted member's read decrements nothing and their send must increment
    // nothing. One increment here with no matching decrement is a badge that
    // climbs until the next reseed, so this is the asymmetry that matters.
    denMembers = [
      { mutedAt: null, userId: "user2" },
      { mutedAt: new Date("2026-01-01T00:00:00.000Z"), userId: "user3" },
    ];
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    expect(unreadRecipients()).toEqual(["user2"]);
  });

  test("a den at the member ceiling badges every reader in one write", async () => {
    // The large case, and the reason the write is a pipeline rather than a
    // loop. Ninety-nine awaited Redis round trips on the send path is the
    // difference between a message and a stall, so the contract is: one call,
    // every reader named.
    const readers = Array.from(
      { length: DEN_LIMITS.membersMax - 1 },
      (_unused, index) => `bulk-${index}`
    );
    denMembers = readers.map((userId) => ({ mutedAt: null, userId }));
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    expect(unreadRecipients()).toEqual(readers);
    // One call, not ninety-nine.
    expect(mockIncrementMany).toHaveBeenCalledTimes(1);
  });

  test("a den full of muted members badges nobody", async () => {
    denMembers = [
      { mutedAt: new Date("2026-01-01T00:00:00.000Z"), userId: "user2" },
      { mutedAt: new Date("2026-01-01T00:00:00.000Z"), userId: "user3" },
    ];
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    expect(unreadRecipients()).toEqual([]);
  });

  test("the same roster produces one badge per message, not one per member", async () => {
    // Two sends, two badges. The counter is a running total, so a send that
    // credited the roster once per send is what makes a member's badge track
    // the number of unread messages their read will then decrement.
    await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(unreadRecipients()).toEqual(["user2", "user3", "user2", "user3"]);
  });
});

describe("a block has no force inside a den", () => {
  // A block is a pair-level rule. The den has no pair, so the send path resolves
  // no peer to test, exactly as the conversation detail gate, the conversation
  // list and the unread seed do not.
  //
  // The bug this pins: the send path used to take `members.find(m => m.userId !==
  // sender)`, which in a den is one arbitrary member out of up to ninety-nine.
  // So whether a send was allowed depended on row order: a room where the
  // blocked person happened to sort first went silent for everybody, and a room
  // where they sorted last did not. Non-deterministic enforcement is worse than
  // none, and inconsistent with every other surface that reads the same roster.

  beforeEach(() => {
    mockMessages.length = 0;
    mockCreate.mockClear();
    mockIncrementMany.mockClear();
    mockIncrementMany.mockImplementation(() => Promise.resolve());
    mockPublishCreated.mockClear();
    mockPublishActivity.mockClear();
    mockCreateDenMessageNotifications.mockClear();
    mockAreBlocked.mockClear();
    mockAreBlocked.mockReturnValue(false);
    mockNextRatchetIndex.mockReset();
    mockNextRatchetIndex.mockReturnValue(0);
    mockKeyUpdateAndCount.mockClear();
    mockConversationUpdate.mockClear();
    mockGetSession.mockClear();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(txClient)
    );
    peerMutedAt = null;
    denMembers = [
      { mutedAt: null, userId: "user2" },
      { mutedAt: null, userId: "user3" },
    ];
  });

  test("a blocked third party does not silence a den", async () => {
    // Every member is "blocked" as far as the mock is concerned, which is the
    // strongest possible version of the bug.
    mockAreBlocked.mockReturnValue(true);
    const res = await POST(validPostRequest(denUrl()), {
      params: Promise.resolve({ id: "den-1" }),
    });
    expect(res.status).toBe(201);
    // The block probe is never even asked, so no query is spent on a rule that
    // does not apply.
    expect(mockAreBlocked).not.toHaveBeenCalled();
  });

  test("a DM send is still refused when the pair is blocked", async () => {
    // The other half. A block still stops a two-person conversation, and it
    // stops it without the sender learning anything they did not already know.
    mockAreBlocked.mockReturnValue(true);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/messages/conversations/:id/messages", () => {
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

  test("passes the cursor through as an id.lt filter", async () => {
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
    expect(olderQuery?.orderBy?.id).toBe("desc");
    expect(newerQuery?.orderBy?.id).toBe("asc");
    expect(olderQuery?.where.id).toEqual({ lte: "m-1" });
    expect(newerQuery?.where.id).toEqual({ gt: "m-1" });
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
    expect(recorded.where.id).toEqual({ gt: "m-30" });
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
