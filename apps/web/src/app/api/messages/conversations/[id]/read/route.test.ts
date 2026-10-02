import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_READ_RECEIPT_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockCount = mock(() => 4);
const mockDecrement = mock(() => 0);
const mockUpdate = mock((_value: unknown) => ({}));
const mockPublishRead = mock(
  (_conversationId: string, _userId: string, _readAt: string) => {
    limiter.service("publish");
    return Promise.resolve();
  }
);
let lastCountWhere: {
  conversationId: string;
  createdAfter: Date;
  senderIds: string[];
} | null = null;
let lastMemberWhere: { conversationId: string; userId: string } | null = null;

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
            { lastReadAt: new Date("2026-01-01T00:00:00Z"), userId: "user1" },
            { lastReadAt: null, userId: "user2" },
          ],
        }
      : null,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          where: (
            predicate: (member: {
              conversationId: { eq: (id: string) => unknown };
              userId: { eq: (id: string) => unknown };
            }) => unknown
          ) => {
            let conversationId = "";
            let userId = "";
            predicate({
              conversationId: {
                eq: (id) => {
                  conversationId = id;
                  return {};
                },
              },
              userId: {
                eq: (id) => {
                  userId = id;
                  return {};
                },
              },
            });
            lastMemberWhere = { conversationId, userId };
            return { update: mockUpdate };
          },
        },
        Messages: {
          where: (
            predicate: (message: {
              conversationId: { eq: (id: string) => unknown };
              createdAt: { gt: (value: Date) => unknown };
              deletedAt: { isNull: () => unknown };
              senderId: { notIn: (ids: string[]) => unknown };
            }) => unknown
          ) => {
            let conversationId = "";
            let createdAfter = new Date(0);
            let senderIds: string[] = [];
            predicate({
              conversationId: {
                eq: (id) => {
                  conversationId = id;
                  return {};
                },
              },
              createdAt: {
                gt: (value) => {
                  createdAfter = value;
                  return {};
                },
              },
              deletedAt: { isNull: () => ({}) },
              senderId: {
                notIn: (ids) => {
                  senderIds = ids;
                  return {};
                },
              },
            });
            return {
              aggregate: (
                aggregate: (value: { count: () => number }) => unknown
              ) => {
                lastCountWhere = { conversationId, createdAfter, senderIds };
                return aggregate({ count: mockCount });
              },
            };
          },
        },
      },
    },
  },
  publishConversationRead: mockPublishRead,
  unreadMessageCache: { decrement: mockDecrement },
  // The shared predicate: an unread message is one the user received (not
  // sent), not deleted, hidden with "delete for me", and newer than the
  // conversation's read watermark.
  unreadMessageWhere:
    (params: {
      conversationId: string;
      lastReadAt: Date | null;
      userId: string;
    }) =>
    (message: {
      conversationId: { eq: (id: string) => unknown };
      createdAt: { gt: (value: Date) => unknown };
      deletedAt: { isNull: () => unknown };
      senderId: { notIn: (ids: string[]) => unknown };
    }) => ({
      conversationId: message.conversationId.eq(params.conversationId),
      createdAt: message.createdAt.gt(params.lastReadAt ?? new Date(0)),
      deletedAt: message.deletedAt.isNull(),
      senderId: message.senderId.notIn([params.userId]),
    }),
}));

function read() {
  return POST(new Request("http://localhost:3000/read", { method: "POST" }), {
    params: Promise.resolve({ id: "convo-1" }),
  });
}

describe("POST /api/messages/conversations/:id/read", () => {
  beforeEach(() => {
    mockCount.mockClear();
    mockDecrement.mockClear();
    mockUpdate.mockClear();
    mockPublishRead.mockClear();
    mockGetSession.mockClear();
    lastCountWhere = null;
    lastMemberWhere = null;
    limiter.reset();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(
      new Request("http://localhost:3000/read", { method: "POST" }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(401);
  });

  test("decrements the badge by exactly the unread count and stamps lastReadAt", async () => {
    const res = await POST(
      new Request("http://localhost:3000/read", { method: "POST" }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(200);
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(lastCountWhere).toEqual({
      conversationId: "convo-1",
      createdAfter: new Date("2026-01-01T00:00:00Z"),
      senderIds: ["user1"],
    });
    expect(mockDecrement).toHaveBeenCalledWith("user1", 4);
    expect(lastMemberWhere).toEqual({
      conversationId: "convo-1",
      userId: "user1",
    });
    const updateValue = mockUpdate.mock.calls[0]?.[0] as {
      lastDeliveredAt: Date;
      lastReadAt: Date;
    };
    expect(updateValue.lastReadAt).toBeInstanceOf(Date);
    // Reading implies delivery, so both watermarks advance in one write.
    expect(updateValue.lastDeliveredAt).toBeInstanceOf(Date);
    // The read event carries the read timestamp so senders can patch their
    // watermark without refetching the conversation detail.
    expect(mockPublishRead).toHaveBeenCalledTimes(1);
    expect(mockPublishRead).toHaveBeenCalledWith(
      "convo-1",
      "user1",
      expect.any(String)
    );
  });

  test("skips the decrement when there is nothing unread", async () => {
    mockCount.mockReturnValueOnce(0);
    await POST(new Request("http://localhost:3000/read", { method: "POST" }), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(mockDecrement).not.toHaveBeenCalled();
  });
});

describe("POST /api/messages/conversations/:id/read rate limit", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockCount.mockClear();
    mockDecrement.mockClear();
    mockUpdate.mockClear();
    mockPublishRead.mockClear();
    lastCountWhere = null;
    lastMemberWhere = null;
    limiter.reset();
  });

  test("spends the read-receipt budget, per account", async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([
      DEN_READ_RECEIPT_RATE_LIMIT.bucket,
    ]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and moves no watermark when over budget", async () => {
    // A read receipt is a COUNT over the unread range plus a locked member-row
    // update. If the limiter ran after either, the refusal would be a message to
    // the client that the work had already been done.
    limiter.setDenied(true);
    const res = await read();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPublishRead).not.toHaveBeenCalled();
  });

  test("charges the limiter before it reads the roster", async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(limiter.order).toEqual([
      `consume:${DEN_READ_RECEIPT_RATE_LIMIT.bucket}`,
      "service:publish",
    ]);
  });

  test("two accounts do not share one budget", async () => {
    await read();
    mockGetSession.mockImplementation(() => ({ user: { id: "user2" } }));
    await read();
    expect(limiter.chargedIdentifiers).toEqual(["user1", "user2"]);
  });
});
