import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

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
let lastCountWhere: {
  conversationId: string;
  createdAfter: Date;
  senderIds: string[];
} | null = null;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        Blocks: {
          select: () => ({ where: () => ({ all: () => Promise.resolve([]) }) }),
        },
        MessageConversationMembers: {
          select: () => ({ where: () => ({ all: mockMemberships }) }),
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
    lastCountWhere = null;
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
    expect(lastCountWhere).toEqual({
      conversationId: "convo-1",
      createdAfter: new Date("2026-01-01T00:00:00Z"),
      senderIds: ["user1"],
    });
  });
});
