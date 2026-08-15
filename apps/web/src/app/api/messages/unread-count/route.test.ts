import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockCacheGet = mock(() => null);
const mockCacheIncrement = mock(() => 1);
const mockMemberships = mock(() => [
  { lastReadAt: new Date("2026-01-01T00:00:00Z") },
]);
const mockCount = mock(() => 7);

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
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
    // The count must be bounded by the earliest lastReadAt.
    const countArgs = mockCount.mock.calls[0]?.[0] as {
      where: { createdAt: { gt: Date } };
    };
    expect(countArgs.where.createdAt.gt).toEqual(
      new Date("2026-01-01T00:00:00Z")
    );
  });
});
