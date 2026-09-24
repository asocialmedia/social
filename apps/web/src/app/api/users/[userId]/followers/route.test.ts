import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DELETE, POST } from "./route";

const FOLLOWED_ID = "followed1";
const FOLLOWER_ID = "follower1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: FOLLOWER_ID },
}));

// Open positions stored on the follow row.
const state = {
  auraLogs: [] as Record<string, unknown>[],
  followRow: null as null | { gainedAura: number; givenAura: number },
  followedAura: 0,
  followerAura: 0,
  isFollowing: false as boolean,
  notifications: [] as Record<string, unknown>[],
};

function resetState() {
  state.followedAura = 0;
  state.followerAura = 0;
  state.auraLogs = [];
  state.isFollowing = false;
  state.followRow = null;
  state.notifications = [];
}

function createFollowOrm() {
  const findFollow = (followerId: string, followingId: string) =>
    state.isFollowing &&
    followerId === FOLLOWER_ID &&
    followingId === FOLLOWED_ID
      ? {
          gainedAura: state.followRow?.gainedAura ?? 0,
          givenAura: state.followRow?.givenAura ?? 0,
          id: "follow-1",
        }
      : null;
  return {
    AuraLogs: {
      create: (data: Record<string, unknown>) => {
        const { _type, ...rest } = data;
        return mockTx.auraLog.create({ data: { ...rest, type: _type } });
      },
      where: () => ({
        aggregate: (
          aggregate: (value: {
            count: () => number;
            sum: (field: string) => number;
          }) => unknown
        ) => aggregate({ count: () => 0, sum: () => 0 }),
      }),
    },
    Follows: {
      create: (data: Record<string, unknown>) =>
        mockTx.follow.create({
          data: data as { gainedAura: number; givenAura: number },
        }),
      select: () => ({ where: () => ({ first: () => null }) }),
      where: (
        predicate: (follow: {
          followerId: { eq: (id: string) => unknown };
          followingId: { eq: (id: string) => unknown };
        }) => unknown
      ) => {
        let followerId = "";
        let followingId = "";
        predicate({
          followerId: { eq: (id) => (followerId = id) },
          followingId: { eq: (id) => (followingId = id) },
        });
        const find = () => findFollow(followerId, followingId);
        return {
          aggregate: (aggregate: (value: { count: () => number }) => unknown) =>
            aggregate({ count: () => (state.isFollowing ? 1 : 0) }),
          delete: () => {
            if (find()) {
              state.isFollowing = false;
            }
            return Promise.resolve({});
          },
          first: find,
        };
      },
    },
    Notifications: {
      select: () => ({
        create: (data: Record<string, unknown>) => {
          const { _type, ...rest } = data;
          return mockTx.notification.create({
            data: { ...rest, type: _type },
          });
        },
        where: (
          predicate: (notification: {
            issuerId: { eq: (id: string) => unknown };
            recipientId: { eq: (id: string) => unknown };
            _type: { eq: (type: string) => unknown };
          }) => unknown
        ) => {
          let issuerId = "";
          let recipientId = "";
          let type = "";
          predicate({
            _type: { eq: (value) => (type = value) },
            issuerId: { eq: (id) => (issuerId = id) },
            recipientId: { eq: (id) => (recipientId = id) },
          });
          return {
            delete: () => {
              state.notifications = state.notifications.filter(
                (notification) =>
                  !(
                    notification.issuerId === issuerId &&
                    notification.recipientId === recipientId &&
                    notification.type === type
                  )
              );
              return Promise.resolve({});
            },
          };
        },
      }),
      where: (
        predicate: (notification: {
          issuerId: { eq: (id: string) => unknown };
          recipientId: { eq: (id: string) => unknown };
          _type: { eq: (type: string) => unknown };
        }) => unknown
      ) => {
        let issuerId = "";
        let recipientId = "";
        let type = "";
        predicate({
          _type: { eq: (value) => (type = value) },
          issuerId: { eq: (id) => (issuerId = id) },
          recipientId: { eq: (id) => (recipientId = id) },
        });
        return {
          delete: () => {
            state.notifications = state.notifications.filter(
              (notification) =>
                !(
                  notification.issuerId === issuerId &&
                  notification.recipientId === recipientId &&
                  notification.type === type
                )
            );
            return Promise.resolve({});
          },
        };
      },
    },
    Users: {
      select: (...fields: string[]) => ({
        where: (where: { id: string }) => ({
          first: () => {
            if (fields.includes("createdAt")) {
              return Promise.resolve({ aura: 12_000, createdAt: new Date(0) });
            }
            if (where.id === FOLLOWED_ID) {
              return Promise.resolve({
                aura: state.followedAura,
                createdAt: new Date(0),
                displayName: "Alice",
                id: FOLLOWED_ID,
                username: "alice",
              });
            }
            return Promise.resolve({ aura: state.followerAura });
          },
        }),
      }),
      where: (
        predicate: (user: {
          aura: { eq: (value: number) => unknown };
          id: { eq: (id: string) => unknown };
        }) => unknown
      ) => {
        let userId = "";
        let _aura = 0;
        predicate({
          aura: { eq: (value) => (_aura = value) },
          id: { eq: (id) => (userId = id) },
        });
        return {
          updateAndCount: ({ aura: nextAura }: { aura: number }) => {
            if (userId === FOLLOWED_ID) {
              state.followedAura = nextAura;
            } else {
              state.followerAura = nextAura;
            }
            return Promise.resolve(1);
          },
        };
      },
    },
  };
}

const mockTx = {
  auraLog: {
    // Real ledger helpers read pair history and daily income through these;
    // zeroed fixtures mean awards land at full price under an empty cap.
    aggregate: () => Promise.resolve({ _sum: { amount: 0 } }),
    count: () => Promise.resolve(0),
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
      return Promise.resolve({});
    },
  },
  follow: {
    create: (args: { data: { gainedAura: number; givenAura: number } }) => {
      state.isFollowing = true;
      state.followRow = {
        gainedAura: args.data.gainedAura,
        givenAura: args.data.givenAura,
      };
    },
    delete: () => {
      state.isFollowing = false;
    },
    findUnique: () =>
      state.isFollowing
        ? {
            gainedAura: state.followRow?.gainedAura ?? 0,
            givenAura: state.followRow?.givenAura ?? 0,
            id: "follow-1",
          }
        : null,
  },
  notification: {
    create: (args: { data: Record<string, unknown> }) => {
      state.notifications.push(args.data);
      return Promise.resolve({});
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
      return Promise.resolve({});
    },
  },
  orm: { public: createFollowOrm() },
  user: {
    // Two shapes are requested: the follower credibility snapshot and the
    // final profile payload.
    findUnique: (args: { select?: Record<string, unknown> }) => {
      const select = args.select ?? {};
      if ("aura" in select && "createdAt" in select) {
        // A maximally credible follower: weighted awards land at full price.
        return Promise.resolve({ aura: 12_000, createdAt: new Date(0) });
      }
      return Promise.resolve({
        _count: { followers: 1 },
        displayName: "Alice",
        id: FOLLOWED_ID,
        username: "alice",
      });
    },
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
      return Promise.resolve({});
    },
  },
};

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  orm: { public: createFollowOrm() },
  transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
};

mock.module("@asm/config/debug", () => ({
  debugLog: { api: () => {} },
}));

// Only IO-bound exports are patched; the real ledger helpers and constants
// run against the fake tx so route orchestration is tested end-to-end.
mock.module("@asm/db", () => ({
  and: (...conditions: unknown[]) => conditions,
  followerInfoCache: { invalidate: () => {} },
  fromPrismaDateTime: (value: Date): Date => value,
  invalidateAuraSignals: () => Promise.resolve(),
  invalidateFypProfile: () => Promise.resolve(),
  prisma: mockPrisma,
  toPrismaDateTime: (value: Date): Date => value,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/users/suggested-users-cache", () => ({
  suggestedUsersCache: {
    invalidate: () => Promise.resolve(),
    invalidateForUser: () => {},
  },
}));

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

  test("following credits a weighted gain to the followed user and a flat stipend to the follower", async () => {
    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(true);
    // FOLLOW_GAINED_AURA (10) at full veteran credibility; flat +1 stipend.
    expect(state.followedAura).toBe(10);
    expect(state.followerAura).toBe(1);
    expect(state.followRow).toEqual({ gainedAura: 10, givenAura: 1 });
    expect(state.auraLogs).toEqual([
      {
        amount: 10,
        commentId: null,
        id: expect.any(String),
        issuerId: FOLLOWER_ID,
        postId: null,
        targetUserId: FOLLOWED_ID,
        type: "FOLLOW_GAINED",
        userId: FOLLOWED_ID,
      },
      {
        amount: 1,
        commentId: null,
        id: expect.any(String),
        issuerId: FOLLOWER_ID,
        postId: null,
        targetUserId: FOLLOWER_ID,
        type: "FOLLOW_GIVEN",
        userId: FOLLOWER_ID,
      },
    ]);
  });

  test("following again is a no-op and awards no aura", async () => {
    state.isFollowing = true;
    state.followRow = { gainedAura: 4, givenAura: 1 };
    state.followedAura = 4;
    state.followerAura = 1;

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(true);
    expect(state.followedAura).toBe(4);
    expect(state.followerAura).toBe(1);
    expect(state.auraLogs).toEqual([]);
  });

  test("self-follow is rejected outright", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: FOLLOWED_ID } });

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(400);
    expect(state.isFollowing).toBe(false);
    expect(state.auraLogs).toEqual([]);
  });
});

describe("DELETE /api/users/[userId]/followers", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("unfollowing reverses exactly the stored positions", async () => {
    state.followedAura = 4;
    state.followerAura = 1;
    state.isFollowing = true;
    state.followRow = { gainedAura: 4, givenAura: 1 };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(false);
    expect(state.followedAura).toBe(0);
    expect(state.followerAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        amount: -4,
        commentId: null,
        id: expect.any(String),
        issuerId: FOLLOWER_ID,
        postId: null,
        targetUserId: FOLLOWED_ID,
        type: "FOLLOW_GAINED",
        userId: FOLLOWED_ID,
      },
      {
        amount: -1,
        commentId: null,
        id: expect.any(String),
        issuerId: FOLLOWER_ID,
        postId: null,
        targetUserId: FOLLOWER_ID,
        type: "FOLLOW_GIVEN",
        userId: FOLLOWER_ID,
      },
    ]);
  });

  test("a legacy follow with zero stored positions reverses nothing", async () => {
    // Follows created before the economy shipped carry zeros: conservative
    // under-refund instead of recomputing history.
    state.followedAura = 5;
    state.followerAura = 1;
    state.isFollowing = true;
    state.followRow = { gainedAura: 0, givenAura: 0 };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.isFollowing).toBe(false);
    expect(state.followedAura).toBe(5);
    expect(state.followerAura).toBe(1);
    expect(state.auraLogs).toEqual([]);
  });
});
