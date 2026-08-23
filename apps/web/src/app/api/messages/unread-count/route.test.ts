import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockCacheGet = mock((): number | null => null);
const mockCacheIncrement = mock(() => 1);
const mockMemberships = mock(() => [
  {
    conversationId: "convo-1",
    lastReadAt: new Date("2026-01-01T00:00:00Z"),
  },
]);
const mockCount = mock(() => 7);

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
    block: { findMany: mock(() => []) },
    message: { count: mockCount },
    messageConversationMember: { findMany: mockMemberships },
  },
  unreadMessageCache: {
    get: mockCacheGet,
    increment: mockCacheIncrement,
  },
}));

describe("GET /api/messages/unread-count", () => {
  beforeEach(() => {
    mockCacheGet.mockClear();
    mockCacheIncrement.mockClear();
    mockMemberships.mockClear();
    mockCount.mockClear();
    mockGetSession.mockClear();
    mockCacheGet.mockReturnValue(null);
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns the cached counter when present", async () => {
    mockCacheGet.mockReturnValueOnce(3);
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(3);
    expect(mockCount).not.toHaveBeenCalled();
  });

  test("returns 0 without querying when the user has no memberships", async () => {
    mockMemberships.mockReturnValueOnce([]);
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(0);
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockCacheIncrement).not.toHaveBeenCalled();
  });

  test("seeds the cache from the DB baseline", async () => {
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(7);
    expect(mockCacheIncrement).toHaveBeenCalledWith("user1", 7);
    // Each conversation is bounded by its own read watermark, and the count
    // only includes received (not own) undeleted messages.
    const countArgs = mockCount.mock.calls[0]?.[0] as {
      where: {
        conversationId: string;
        createdAt: { gt: Date };
        deletedAt: null;
        senderId: { not: string };
      };
    };
    expect(countArgs.where.conversationId).toBe("convo-1");
    expect(countArgs.where.createdAt.gt).toEqual(
      new Date("2026-01-01T00:00:00Z")
    );
    expect(countArgs.where.senderId).toEqual({ not: "user1" });
    expect(countArgs.where.deletedAt).toBeNull();
  });
});
