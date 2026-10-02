import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_PRESENCE_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET, POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockGetOnline = mock(() => []);
const mockGetIdle = mock((_online: string[]) => []);
const mockFollowFindMany = mock(
  (_direction: "followerId" | "followingId") => []
);
const mockBlockFindMany = mock(() => []);
const mockUserFindMany = mock(() => []);
const mockMarkUserOnline = mock(() => {
  limiter.service("mark-online");
  return Promise.resolve();
});

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// The limiter the presence heartbeat charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getIdleUsers: mockGetIdle,
  getOnlineUsers: mockGetOnline,
  markUserOnline: mockMarkUserOnline,
  prisma: {
    orm: {
      public: {
        Blocks: {
          select: () => ({ where: () => ({ all: mockBlockFindMany }) }),
        },
        Follows: {
          select: () => ({
            where: (
              predicate: (follow: {
                followerId: { eq: (id: string) => unknown };
                followingId: { eq: (id: string) => unknown };
              }) => unknown
            ) => {
              let direction: "followerId" | "followingId" = "followerId";
              predicate({
                followerId: {
                  eq: () => {
                    direction = "followerId";
                    return {};
                  },
                },
                followingId: {
                  eq: () => {
                    direction = "followingId";
                    return {};
                  },
                },
              });
              return { all: () => mockFollowFindMany(direction) };
            },
          }),
        },
        Users: {
          select: () => ({ where: () => ({ all: mockUserFindMany }) }),
        },
      },
    },
  },
}));

function heartbeat() {
  return POST();
}

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
    mockMarkUserOnline.mockClear();
    limiter.reset();
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
    expect(mockFollowFindMany).toHaveBeenCalledWith("followerId");
    expect(mockFollowFindMany).toHaveBeenCalledWith("followingId");
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

describe("POST /api/messages/presence rate limit", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockMarkUserOnline.mockClear();
    limiter.reset();
  });

  test("spends the presence budget, per account", async () => {
    const res = await heartbeat();
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([DEN_PRESENCE_RATE_LIMIT.bucket]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
    expect(mockMarkUserOnline).toHaveBeenCalledWith("user1");
  });

  test("429s with a retry-after and touches no Redis when over budget", async () => {
    // The write is four idempotent Redis commands and no database work, which
    // is exactly why a loop against it needs bounding: nothing accumulates
    // except load. Two a minute is the honest client rate, so sixty is thirty
    // times it.
    limiter.setDenied(true);
    const res = await heartbeat();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockMarkUserOnline).not.toHaveBeenCalled();
  });

  test("charges the limiter before it writes", async () => {
    await heartbeat();
    expect(limiter.order).toEqual([
      `consume:${DEN_PRESENCE_RATE_LIMIT.bucket}`,
      "service:mark-online",
    ]);
  });

  test("the read is not metered by the heartbeat's budget", async () => {
    // GET presence is a follow-graph read, not a write, and the client's poll is
    // every thirty seconds exactly like the heartbeat. Sharing a bucket would
    // make the poll spend the budget that bounds the write.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([]);
  });

  test("the budget is generous enough for a thirty-second heartbeat", () => {
    // Pinned so a future tightening has to say out loud that it is now below
    // what the shipped client does.
    expect(DEN_PRESENCE_RATE_LIMIT.windowSeconds).toBe(60);
    expect(DEN_PRESENCE_RATE_LIMIT.limit).toBeGreaterThanOrEqual(2);
  });
});
