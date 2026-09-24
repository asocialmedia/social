import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockCount = mock(() => 4);
const mockDecrement = mock(() => 0);
const mockUpdate = mock((_value: unknown) => ({}));
const mockPublishRead = mock(() => Promise.resolve());
let lastCountWhere: {
  conversationId: string;
  createdAfter: Date;
  senderIds: string[];
} | null = null;
let lastMemberWhere: { conversationId: string; userId: string } | null = null;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

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
  // The shared predicate: an unread message is one the user received (not
  // sent), not deleted, and newer than the conversation's read watermark.
  unreadMessageWhere: (params: {
    conversationId: string;
    lastReadAt: Date | null;
    userId: string;
  }) => ({
    conversationId: params.conversationId,
    createdAt: { gt: params.lastReadAt ?? new Date(0) },
    deletedAt: null,
    senderId: { not: params.userId },
  }),
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
}));

describe("POST /api/messages/conversations/:id/read", () => {
  beforeEach(() => {
    mockCount.mockClear();
    mockDecrement.mockClear();
    mockUpdate.mockClear();
    mockPublishRead.mockClear();
    mockGetSession.mockClear();
    lastCountWhere = null;
    lastMemberWhere = null;
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
      lastReadAt: Date;
    };
    expect(updateValue.lastReadAt).toBeInstanceOf(Date);
    expect(mockPublishRead).toHaveBeenCalledWith("convo-1", "user1");
  });

  test("skips the decrement when there is nothing unread", async () => {
    mockCount.mockReturnValueOnce(0);
    await POST(new Request("http://localhost:3000/read", { method: "POST" }), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(mockDecrement).not.toHaveBeenCalled();
  });
});
