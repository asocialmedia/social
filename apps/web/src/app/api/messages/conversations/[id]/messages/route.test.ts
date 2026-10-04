import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
  DEN_MESSAGE_SEND_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { GET, POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockNextRatchetIndex = mock(() => 0);

const mockMessages: Record<string, unknown>[] = [];
const mockCreate = mock((args: Record<string, unknown>) => {
  limiter.service("insert-message");
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
// The newest epoch's row, version included: the CAS pins the version it read, so
// the read has to carry one.
const mockKeyFirst = mock(() => ({ ratchetCounter: 0, version: 3 }));
// The row a cursor names. The client holds only an id, and the route's composite
// sort needs the timestamp too, so this read is what turns an id into a keyset
// anchor. Overridable per test so a test can make the anchor vanish.
const mockAnchorFirst = mock(() => ({
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  id: "m-020",
}));
const mockKeyUpdateAndCount = mock(() => 1);
// The columns the ratchet CAS matched on, recorded so a MISSING one is visible.
// Asserting the counter value cannot see a column that was never matched on.
let casWhere: Record<string, unknown> = {};
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
  // The keyset anchor the route sought from, when it used one. Recorded because
  // a composite sort has to be sought on BOTH of its columns, and a cursor
  // carrying only the id is the defect rather than the fix.
  cursorAnchor?: Record<string, unknown>;
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
// One level of nesting is all the combinators produce, but recursing is cheaper
// than being wrong about it later.
function flatten(conditions: unknown[]): object[] {
  return conditions
    .filter(Boolean)
    .flatMap((condition) =>
      Array.isArray(condition) ? flatten(condition) : [condition as object]
    );
}

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
    cursor: (anchor: Record<string, unknown>) => {
      state.cursorAnchor = anchor;
      return query;
    },
    first: () => mockMessageFirst(),
    limit: (n: number) => {
      state.limit = n;
      return query;
    },
    // Both shapes the real API accepts: one predicate, or an array of them for a
    // composite sort. The transcript needs the array form - a chronological sort
    // with the id breaking ties is two columns - so a single-predicate mock would
    // make the fix untestable rather than merely awkward.
    orderBy: (
      predicate:
        | ((accessor: unknown) => unknown)
        | ((accessor: unknown) => unknown)[]
    ) => {
      const built = Array.isArray(predicate)
        ? predicate.map((entry) => entry(recordingAccessor()))
        : predicate(recordingAccessor());
      const entries = (Array.isArray(built) ? built : [built]).flatMap(
        (entry) =>
          typeof entry === "string" ? [entry.split(":")] : ([] as string[][])
      );
      state.orderBy = Object.fromEntries(
        entries.map(([column, direction]) => [column ?? "", direction ?? "asc"])
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
        // The ratchet CAS, inside the transaction. Its predicate is recorded
        // because the defect was a MISSING column rather than a wrong value, and
        // asserting the new value cannot see a column that was never matched on.
        where: (filter: ((accessor: unknown) => unknown) | object) => {
          casWhere =
            typeof filter === "function"
              ? (filter(recordingAccessor()) as Record<string, unknown>)
              : (filter as Record<string, unknown>);
          return { updateAndCount: mockKeyUpdateAndCount };
        },
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

// The send limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@asm/db", () => ({
  // The real `and` composes predicates into one expression; merging the recorded
  // column predicates into a flat object is what makes the composed query
  // inspectable.
  //
  // Flattened, because the real combinators nest: a row-wise bound like
  // `(createdAt, id) <= anchor` is an `or` of two branches, one of which is an
  // `and`, and a mock that cannot flatten reports the branch list under numeric
  // keys instead of under the columns it touches.
  and: (...conditions: unknown[]) => Object.assign({}, ...flatten(conditions)),
  consumeRateLimit: mockConsumeRateLimit,
  createDenMessageNotifications: mockCreateDenMessageNotifications,
  enqueueNotificationCreated: mockEnqueueNotificationCreated,
  enqueueNotificationDeleted: mock(() => Promise.resolve()),
  fromPrismaDateTime: (value: Date) => value,
  getMessageDataQuery: buildMessageQuery,
  or: (...conditions: unknown[]) => flatten(conditions),
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
        Messages: {
          create: mockCreate,
          select: () => ({ where: () => ({ first: mockAnchorFirst }) }),
        },
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
    limiter.reset();
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

  test("the ratchet CAS pins the epoch it read, not just the counter", async () => {
    // A member holds one wrap per root-key epoch, so a rotated key leaves several
    // rows for the same conversation - and freshly rotated ones share a counter,
    // because rotation copies it rather than advancing it. Matching on the counter
    // alone therefore updated EVERY epoch at that value, `updateAndCount` returned
    // something other than 1, and the retry re-read the same untouched state and
    // failed identically until it gave up. The send then 500ed with "Could not
    // update message ratchet" in any conversation whose keys had been rotated.
    //
    // `(conversationId, ownerUserId, version)` is a unique key, so pinning version
    // makes the write hit exactly one row and `updated === 1` a real
    // compare-and-swap again.
    await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({ ciphertext: "abc", iv: "def", ratchetIndex: 0 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(casWhere.version).toEqual({ eq: 3 });
    // The counter is still part of the CAS, so a lost race is still detected.
    expect(casWhere.ratchetCounter).toEqual({ eq: 0 });
    // And it wrote the NEXT value, once.
    expect(mockKeyUpdateAndCount).toHaveBeenCalledWith({ ratchetCounter: 1 });
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
    casWhere = {};
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

  test("orders chronologically, so a random id cannot shuffle the transcript", async () => {
    // The regression this file exists for. `messages.id` is a random UUID, so an
    // id-ordered page returns messages in an order unrelated to when they were
    // sent - measured on a 100-message thread, 53 of 99 adjacent pairs came back
    // inverted, and a freshly sent message landed anywhere in the window.
    mockFindMany.mockReturnValueOnce([{ id: "m-001" }]);
    const req = new Request(convoUrl("messages?cursor=m-020"), {
      method: "GET",
    });
    await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(recorded.orderBy).toEqual({ createdAt: "desc", id: "desc" });
    // And the cursor is a keyset seek over that same pair, not an id range.
    expect(recorded.where.id?.lt).toBeUndefined();
    expect(recorded.cursorAnchor).toEqual({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "m-020",
    });
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
    // Chronological, with the id breaking ties. `id: desc` alone is the defect:
    // message ids are random UUIDs, so that sort is a shuffle.
    expect(olderQuery?.orderBy).toEqual({ createdAt: "desc", id: "desc" });
    expect(newerQuery?.orderBy).toEqual({ createdAt: "asc", id: "asc" });
    // The older half is INCLUSIVE of the anchor, so `anchorIndex` can point at
    // it, and the bound has to be a row-wise `<=` over the same pair rather than
    // an id comparison - an id bound compares a random value.
    expect(olderQuery?.where.createdAt).toBeDefined();
    // And the newer half must be STRICT, or the anchor returns on both sides.
    expect(newerQuery?.where.createdAt).toBeDefined();
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
    expect(recorded.orderBy).toEqual({ createdAt: "asc", id: "asc" });
    // Seeking, not an id filter. The client holds only the id, so the route
    // resolved the anchor's timestamp and seeks on BOTH columns of the sort; a
    // seek on the id alone pages a range that has nothing to do with time.
    expect(recorded.cursorAnchor).toEqual({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "m-30",
    });
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

describe("the send budget", () => {
  beforeEach(() => {
    mockMessages.length = 0;
    // Explicit, because the block and ratchet doubles are shared with the
    // describes above and a sibling's return value would otherwise leak in and
    // answer 403 to a test that only cares about the budget.
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockImplementation(() => false);
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
    limiter.reset();
  });

  function send() {
    return POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
  }

  test("a send spends the burst budget and the sustained budget", async () => {
    // Two buckets on one operation, on purpose. The ten-second one stops a
    // burst; the hourly one stops the caller who stays just under it, which is
    // 6,840 messages an hour and invisible to a ten-second window. Same shape as
    // Slack's posting limit - per-channel rate plus a workspace-wide ceiling.
    const res = await send();
    expect(res.status).toBe(201);
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_SEND_RATE_LIMIT.bucket,
      DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.bucket,
    ]);
    expect(limiter.chargedIdentifiers).toEqual(["user1", "user1"]);
  });

  test("429s with a retry-after and inserts nothing when the burst budget is gone", async () => {
    // The whole point. One accepted send is a roster read, a ratchet CAS, an
    // insert, a locked conversation bump, a notification fold for every unmuted
    // member, a counter increment, and one activity publish PER MEMBER. If the
    // limiter ran after the transaction, every one of those had already happened.
    limiter.setDenied(true);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockIncrementMany).not.toHaveBeenCalled();
    expect(mockPublishCreated).not.toHaveBeenCalled();
    expect(mockPublishActivity).not.toHaveBeenCalled();
  });

  test("429s on the sustained budget without touching the transaction either", async () => {
    // Only the hourly budget is exhausted. This is the attacker the ten-second
    // one cannot see: under the burst limit on every single window, and 6,840
    // messages an hour.
    limiter.setDeniedBucket(DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.bucket);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_SEND_RATE_LIMIT.bucket,
      DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.bucket,
    ]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("an exhausted burst budget short-circuits the sustained one", async () => {
    // Worth pinning: it means a flooder cannot make the hourly counter record
    // hits it was already refused, so the hourly budget measures sends that were
    // actually admitted rather than requests that arrived.
    limiter.setDenied(true);
    await send();
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_SEND_RATE_LIMIT.bucket,
    ]);
  });

  test("charges both budgets before it reads the roster", async () => {
    const res = await send();
    expect(res.status).toBe(201);
    expect(limiter.order).toEqual([
      `consume:${DEN_MESSAGE_SEND_RATE_LIMIT.bucket}`,
      `consume:${DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.bucket}`,
      "service:insert-message",
    ]);
  });

  test("the burst budget sits above every published human-facing figure", () => {
    // Slack publishes 1 message per second per channel and tolerates short
    // bursts; Telegram publishes ~1 per second in a chat; Discord's gateway
    // allowlist is 120 events per 60s for everything, so three a second for one
    // event type would already exceed it. Two a second is above all three, which
    // is the point: a limiter tighter than what the platforms permit throttles
    // honest users to protect the database from a script.
    const perSecond =
      DEN_MESSAGE_SEND_RATE_LIMIT.limit /
      DEN_MESSAGE_SEND_RATE_LIMIT.windowSeconds;
    expect(perSecond).toBeGreaterThan(1);
    expect(perSecond).toBeLessThanOrEqual(3);
  });

  test("both send budgets slide, so there is no window boundary to aim at", () => {
    // A fixed window would let a caller spend twenty sends at 9.9s and twenty
    // more at 10.1s: 40 in 200ms against a stated budget of 20.
    expect(DEN_MESSAGE_SEND_RATE_LIMIT.window).toBe("sliding");
    expect(DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.window).toBe("sliding");
  });

  test("two accounts do not share one send budget", async () => {
    await send();
    mockGetSession.mockImplementation(() => ({ user: { id: "user2" } }));
    await send();
    expect(limiter.chargedIdentifiers).toEqual([
      "user1",
      "user1",
      "user2",
      "user2",
    ]);
  });

  test("the sustained budget is ten a minute, not ten an hour", () => {
    // Pinned because the number is the difference between bounding a script and
    // bounding a person: 600 an hour is a script, 60 an hour would start
    // refusing somebody pasting a long conversation into a DM.
    expect(DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.windowSeconds).toBe(3600);
    expect(DEN_MESSAGE_SEND_HOUR_RATE_LIMIT.limit).toBe(600);
  });

  test("an unauthenticated caller is refused before any budget is spent", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await send();
    expect(res.status).toBe(401);
    expect(limiter.chargedBuckets).toEqual([]);
  });
});
