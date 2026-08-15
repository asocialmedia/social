import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockGetOnline = mock(() => []);
const mockGetIdle = mock((_online: string[]) => []);
const mockFollowFindMany = mock(() => []);
const mockBlockFindMany = mock(() => []);
const mockUserFindMany = mock(() => []);

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  getIdleUsers: mockGetIdle,
  getOnlineUsers: mockGetOnline,
  prisma: {
    block: { findMany: mockBlockFindMany },
    follow: { findMany: mockFollowFindMany },
    user: { findMany: mockUserFindMany },
  },
}));

describe("GET /api/messages/presence", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockGetOnline.mockClear();
    mockGetIdle.mockClear();
    mockFollowFindMany.mockClear();
    mockBlockFindMany.mockClear();
    mockUserFindMany.mockClear();
    mockGetOnline.mockReturnValue([]);
    mockGetIdle.mockReturnValue([]);
    mockFollowFindMany.mockReturnValue([]);
    mockBlockFindMany.mockReturnValue([]);
    mockUserFindMany.mockReturnValue([]);
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("shows online users I follow", async () => {
    mockGetOnline.mockReturnValueOnce(["user2"]);
    mockGetIdle.mockReturnValueOnce([]);
    mockFollowFindMany.mockReturnValueOnce([
      { followerId: "user1", followingId: "user2" },
    ]);
    mockUserFindMany.mockReturnValueOnce([
      { avatarUrl: null, displayName: "Bob", id: "user2", username: "bob" },
    ]);
    const res = await GET();
    const body = (await res.json()) as {
      users: { id: string; status: string }[];
    };
    expect(body.users).toEqual([
      {
        avatarUrl: null,
        displayName: "Bob",
        id: "user2",
        status: "online",
        username: "bob",
      },
    ]);
  });

  test("shows online users who follow me but whom I do not follow back (mutual presence)", async () => {
    // DM creation only requires the sender to follow the recipient, so the
    // reciprocal side may never follow back. Presence must still be mutual:
    // a follow in EITHER direction makes the pair visible to each other.
    mockGetOnline.mockReturnValueOnce(["user2"]);
    mockGetIdle.mockReturnValueOnce([]);
    mockFollowFindMany.mockReturnValueOnce([
      { followerId: "user2", followingId: "user1" },
    ]);
    mockUserFindMany.mockReturnValueOnce([
      { avatarUrl: null, displayName: "Bob", id: "user2", username: "bob" },
    ]);
    const res = await GET();
    const body = (await res.json()) as {
      users: { id: string; status: string }[];
    };
    expect(body.users.map((u) => u.id)).toEqual(["user2"]);
    // The follow query must include both directions.
    expect(mockFollowFindMany).toHaveBeenCalledWith({
      select: { followerId: true, followingId: true },
      where: {
        OR: [{ followerId: "user1" }, { followingId: "user1" }],
      },
    });
  });

  test("never includes the caller themselves", async () => {
    mockGetOnline.mockReturnValueOnce(["user1", "user2"]);
    mockGetIdle.mockReturnValueOnce([]);
    mockFollowFindMany.mockReturnValueOnce([
      { followerId: "user1", followingId: "user2" },
    ]);
    mockUserFindMany.mockReturnValueOnce([
      { avatarUrl: null, displayName: "Bob", id: "user2", username: "bob" },
    ]);
    const res = await GET();
    const body = (await res.json()) as {
      users: { id: string }[];
    };
    expect(body.users.map((u) => u.id)).toEqual(["user2"]);
  });
});
