import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockCount = mock(() => 4);
const mockDecrement = mock(() => 0);
const mockUpdate = mock(() => ({}));
const mockPublishRead = mock(() => Promise.resolve());

mock.module("@/lib/session", () => ({
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
}));

mock.module("@asm/db", () => ({
  prisma: {
    message: { count: mockCount },
    messageConversationMember: { update: mockUpdate },
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
    expect(mockDecrement).toHaveBeenCalledWith("user1", 4);
    const updateArgs = mockUpdate.mock.calls[0]?.[0] as {
      data: { lastReadAt: Date };
      where: {
        conversationId_userId: { conversationId: string; userId: string };
      };
    };
    expect(updateArgs.where.conversationId_userId).toEqual({
      conversationId: "convo-1",
      userId: "user1",
    });
    expect(updateArgs.data.lastReadAt).toBeInstanceOf(Date);
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
