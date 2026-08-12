import { beforeEach, describe, expect, mock, test } from "bun:test";

const FOLLOWED_ID = "followed1";
const FOLLOWER_ID = "follower1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: FOLLOWER_ID },
}));

const state = {
  followedAura: 0,
  followerAura: 0,
  auraLogs: [] as Record<string, unknown>[],
  isFollowing: false as boolean,
  notifications: [] as Record<string, unknown>[],
};

function resetState() {
  state.followedAura = 0;
  state.followerAura = 0;
  state.auraLogs = [];
  state.isFollowing = false;
  state.notifications = [];
}

const mockTx = {
  follow: {
    create: () => {
      state.isFollowing = true;
    },
    delete: () => {
      state.isFollowing = false;
    },
    deleteMany: () => undefined,
    findUnique: () => (state.isFollowing ? { id: "follow-1" } : null),
  },
  notification: {
    create: (args: { data: Record<string, unknown> }) => {
      state.notifications.push(args.data);
    },
    deleteMany: (args: {
      where: {
        issuerId: string;
        recipientId: string;
        type: string;
      };
    }) => {
      const { issuerId, recipientId, type } = args.where;
      state.notifications = state.notifications.filter(
        (notification) =>
          !(
            notification.type === type &&
            notification.recipientId === recipientId &&
            notification.issuerId === issuerId
          )
      );
    },
  },
  user: {
    findUnique: () => ({
      id: FOLLOWED_ID,
      displayName: "Alice",
      username: "alice",
      _count: { followers: 1 },
    }),
    update: (args: {
      data: { aura?: { decrement?: number; increment?: number } };
      where: { id: string };
    }) => {
      const delta =
        (args.data.aura?.increment ?? 0) - (args.data.aura?.decrement ?? 0);
      if (args.where.id === FOLLOWED_ID) {
        state.followedAura += delta;
      }
      if (args.where.id === FOLLOWER_ID) {
        state.followerAura += delta;
      }
    },
  },
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
    // Simulates that the follow was created after FOLLOW_GIVEN shipped and
    // therefore earned follower aura.
    findFirst: () => ({ id: "log-1" }),
  },
};

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
};

mock.module("@asm/config/debug", () => ({
  debugLog: { api: () => undefined },
}));

mock.module("@asm/db", () => ({
  followerInfoCache: { invalidate: () => undefined },
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/suggested-users-cache", () => ({
  suggestedUsersCache: { invalidateForUser: () => undefined },
}));

import { DELETE, POST } from "./route";

const context = { params: Promise.resolve({ userId: FOLLOWED_ID }) };

function request(method: string): Request {
  return new Request(`http://localhost/api/users/${FOLLOWED_ID}/followers`, {
    method,
  });
}

describe("POST /api/users/[userId]/followers", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("following credits aura to the followed user and the follower", async () => {
    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(true);
    expect(state.followedAura).toBe(5);
    expect(state.followerAura).toBe(1);
    expect(state.auraLogs).toEqual([
      {
        userId: FOLLOWED_ID,
        issuerId: FOLLOWER_ID,
        amount: 5,
        type: "FOLLOW_GAINED",
      },
      {
        userId: FOLLOWER_ID,
        issuerId: FOLLOWER_ID,
        amount: 1,
        type: "FOLLOW_GIVEN",
      },
    ]);
  });

  test("following again is a no-op and awards no aura", async () => {
    state.isFollowing = true;
    state.followedAura = 5;
    state.followerAura = 1;

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(true);
    expect(state.followedAura).toBe(5);
    expect(state.followerAura).toBe(1);
    expect(state.auraLogs).toEqual([]);
  });
});

describe("DELETE /api/users/[userId]/followers", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("unfollowing revokes aura from the followed user and the follower", async () => {
    state.followedAura = 5;
    state.followerAura = 1;
    state.isFollowing = true;

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(false);
    expect(state.followedAura).toBe(0);
    expect(state.followerAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        userId: FOLLOWED_ID,
        issuerId: FOLLOWER_ID,
        amount: -5,
        type: "FOLLOW_GAINED",
      },
      {
        userId: FOLLOWER_ID,
        issuerId: FOLLOWER_ID,
        amount: -1,
        type: "FOLLOW_GIVEN",
      },
    ]);
  });
});
