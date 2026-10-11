import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_READ_RECEIPT_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
interface Conversation {
  id: string;
  members: {
    createdAt: Date;
    lastReadAt: Date | null;
    leftAt: Date | null;
    mutedAt: Date | null;
    userId: string;
  }[];
  type: "DEN" | "DM";
}

const READ_AT = new Date("2026-01-02T00:00:00Z");
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockCommitRead = mock(() =>
  Promise.resolve({
    readAt: READ_AT,
    readSequence: 8,
    status: "read" as const,
    unreadCount: 4,
  })
);
const mockListMembershipEvents = mock(() => Promise.resolve([]));
const mockDecrement = mock(() => Promise.resolve(0));
const mockPublishRead = mock(
  (_conversationId: string, _userId: string, _readAt: string) => {
    limiter.service("publish");
    return Promise.resolve();
  }
);
let conversation: Conversation;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === conversation.id && userId === "user1"
      ? conversation
      : null,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  commitMessageConversationRead: mockCommitRead,
  listDenMembershipEvents: mockListMembershipEvents,
  publishConversationRead: mockPublishRead,
  unreadMessageCache: { decrement: mockDecrement },
}));

function read() {
  return POST(new Request("http://localhost:3000/read", { method: "POST" }), {
    params: Promise.resolve({ id: "convo-1" }),
  });
}

describe("POST /api/messages/conversations/:id/read", () => {
  beforeEach(() => {
    conversation = {
      id: "convo-1",
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastReadAt: new Date("2026-01-01T00:00:00Z"),
          leftAt: null,
          mutedAt: null,
          userId: "user1",
        },
        {
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastReadAt: null,
          leftAt: null,
          mutedAt: null,
          userId: "user2",
        },
      ],
      type: "DM",
    };
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockCommitRead.mockReset();
    mockCommitRead.mockImplementation(() =>
      Promise.resolve({
        readAt: READ_AT,
        readSequence: 8,
        status: "read",
        unreadCount: 4,
      })
    );
    mockListMembershipEvents.mockReset();
    mockListMembershipEvents.mockImplementation(() => Promise.resolve([]));
    mockDecrement.mockClear();
    mockPublishRead.mockClear();
    limiter.reset();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await read();
    expect(res.status).toBe(401);
    expect(mockCommitRead).not.toHaveBeenCalled();
  });

  test("commits a bounded read and decrements exactly its unread badge count", async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(mockCommitRead).toHaveBeenCalledWith({
      conversationId: "convo-1",
      membershipWindows: [{ after: null, before: null }],
      userId: "user1",
    });
    expect(mockDecrement).toHaveBeenCalledWith("user1", 4);
    expect(mockPublishRead).toHaveBeenCalledWith(
      "convo-1",
      "user1",
      READ_AT.toISOString()
    );
  });

  test("passes den membership stints to the atomic read transaction", async () => {
    conversation.type = "DEN";
    const joinedAt = new Date("2026-01-01T00:00:00Z");
    const leftAt = new Date("2026-01-02T00:00:00Z");
    const rejoinedAt = new Date("2026-01-03T00:00:00Z");
    mockListMembershipEvents.mockResolvedValueOnce([
      {
        action: "CREATED",
        actorId: "user1",
        createdAt: joinedAt,
        targetUserId: null,
      },
      {
        action: "LEFT",
        actorId: "user1",
        createdAt: leftAt,
        targetUserId: null,
      },
      {
        action: "JOINED",
        actorId: "user1",
        createdAt: rejoinedAt,
        targetUserId: null,
      },
    ]);

    const res = await read();
    expect(res.status).toBe(200);
    expect(mockCommitRead.mock.calls[0]?.[0].membershipWindows).toEqual([
      { after: joinedAt, before: leftAt },
      { after: rejoinedAt, before: null },
    ]);
  });

  test("does not decrement the global badge for a muted conversation", async () => {
    const [member] = conversation.members;
    if (!member) {
      throw new Error("expected current member fixture");
    }
    member.mutedAt = new Date("2026-01-01T12:00:00Z");
    mockCommitRead.mockImplementationOnce(() =>
      Promise.resolve({
        readAt: READ_AT,
        readSequence: 8,
        status: "read",
        unreadCount: 0,
      })
    );
    await read();
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("returns a retryable failure without publishing when persistence fails", async () => {
    mockCommitRead.mockRejectedValueOnce(new Error("database unavailable"));
    const res = await read();
    expect(res.status).toBe(503);
    expect(mockDecrement).not.toHaveBeenCalled();
    expect(mockPublishRead).not.toHaveBeenCalled();
  });

  test("skips the decrement when there is nothing unread", async () => {
    mockCommitRead.mockImplementationOnce(() =>
      Promise.resolve({
        readAt: READ_AT,
        readSequence: 8,
        status: "read",
        unreadCount: 0,
      })
    );
    await read();
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("keeps the successful read when the cache decrement fails", async () => {
    mockDecrement.mockRejectedValueOnce(new Error("cache unavailable"));
    const res = await read();
    expect(res.status).toBe(200);
    expect(mockPublishRead).toHaveBeenCalled();
  });

  test("keeps the successful read when realtime publication fails", async () => {
    mockPublishRead.mockImplementationOnce(() =>
      Promise.reject(new Error("event service unavailable"))
    );
    const res = await read();
    expect(res.status).toBe(200);
    expect(mockCommitRead).toHaveBeenCalled();
  });
});

describe("POST /api/messages/conversations/:id/read rate limit", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockCommitRead.mockClear();
    mockDecrement.mockClear();
    mockPublishRead.mockClear();
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

  test("429s before moving the read cursor when over budget", async () => {
    limiter.setDenied(true);
    const res = await read();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockCommitRead).not.toHaveBeenCalled();
    expect(mockPublishRead).not.toHaveBeenCalled();
  });

  test("charges separate budgets for separate accounts", async () => {
    await read();
    mockGetSession.mockImplementation(() => ({ user: { id: "user2" } }));
    await read();
    expect(limiter.chargedIdentifiers).toEqual(["user1", "user2"]);
  });
});
