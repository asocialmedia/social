import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { Context } from "../../trpc";

class BadgeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeLimitError";
  }
}

const mockAdminCount = mock(() => 0);
const mockCurrentUser = mock((): { role: string } | null => null);
const mockUpdateUser = mock(() => Promise.resolve({ id: "u" }));
const mockUpdateAndCount = mock(() => 1);
const mockDeleteAndCount = mock(() => 1);
const mockFindAdmins = mock((): { id: string }[] => []);
const mockTotalUsers = mock(() => 0);
const mockTotalPosts = mock(() => 0);
const mockTotalAura = mock(() => 0);
const mockTopUsers = mock(
  (): {
    aura: number;
    displayName: string;
    id: string;
    username: string;
  }[] => []
);
const mockOauthGroups = mock(
  (): {
    count: number;
    googleId: string | null;
    redditId: string | null;
  }[] => []
);
const mockSessionRows = mock((): { createdAt: Date }[] => []);
const mockRegistrationRows = mock((): { createdAt: Date }[] => []);
let mockWhereAggregateResults: number[] = [];

function mockWhereAggregate() {
  return mockWhereAggregateResults.shift() ?? mockAdminCount();
}

const usersWhereQuery = {
  aggregate: () => ({ count: mockWhereAggregate() }),
  all: mockFindAdmins,
  deleteAndCount: mockDeleteAndCount,
  update: mockUpdateUser,
  updateAndCount: mockUpdateAndCount,
};
const usersSelectedQuery = {
  all: mockTopUsers,
  limit: () => usersSelectedQuery,
  orderBy: () => usersSelectedQuery,
  where: () => ({
    all: () => {
      const admins = mockFindAdmins();
      return admins.length > 0 ? admins : mockRegistrationRows();
    },
    first: mockCurrentUser,
    update: mockUpdateUser,
  }),
};
const usersCollection = {
  aggregate: () => ({
    aura: mockTotalAura(),
    count: mockTotalUsers(),
  }),
  groupBy: () => ({ aggregate: () => mockOauthGroups() }),
  select: () => usersSelectedQuery,
  where: () => usersWhereQuery,
};
const prismaMock = {
  orm: {
    public: {
      Posts: { aggregate: () => ({ count: mockTotalPosts() }) },
      Sessions: {
        select: () => ({ where: () => ({ all: mockSessionRows }) }),
      },
      Users: usersCollection,
    },
  },
  transaction: mock(
    (fn: (tx: typeof prismaMock) => Promise<unknown>): Promise<unknown> =>
      fn(prismaMock)
  ),
};

const userCacheMock = {
  checkRateLimit: mock((): Promise<{ allowed: boolean; resetTime: number }> =>
    Promise.resolve({ allowed: true, resetTime: 0 })
  ),
  getAnalytics: mock(() => Promise.resolve(null)),
  getUserStats: mock(() => Promise.resolve(null)),
  invalidateSearchCache: mock((): Promise<void> => Promise.resolve()),
  invalidateUserDetail: mock((): Promise<void> => Promise.resolve()),
  invalidateUserList: mock((): Promise<void> => Promise.resolve()),
  invalidateUserStats: mock((): Promise<void> => Promise.resolve()),
  setAnalytics: mock(() => Promise.resolve()),
  setUserStats: mock(() => Promise.resolve()),
};

const grantBadgeMock = mock((): Promise<boolean> => Promise.resolve(true));
const revokeBadgeMock = mock((): Promise<boolean> => Promise.resolve(true));

mock.module("@asm/auth/core", () => ({
  getSessionFromRequest: mock(() => ({ session: null, user: null })),
}));

mock.module("@asm/db", () => ({
  ATTACHMENT_BONUSES: {},
  BADGES: ["author", "dev", "early", "shitposter"],
  BadgeLimitError,
  HN_SHARE_BONUS_AURA: 15,
  MENTION_RECEIVED_AURA: 10,
  POST_CREATION_AURA: 10,
  POST_CREATION_MAX_AURA: 150,
  POST_VIEWS_KEY_PREFIX: "post:views:",
  POST_VIEWS_SET: "posts:with:views",
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  and: (...expressions: unknown[]) => expressions,
  applyFlatAward: () => Promise.resolve({ amount: 10 }),
  applyModerationPenalty: () => Promise.resolve(),
  cancelMediaCleanup: () => Promise.resolve(),
  enqueueNotificationCreated: () => Promise.resolve(),
  enqueuePostDeleted: () => Promise.resolve(),
  enqueueShitposterCheck: () => Promise.resolve(),
  fromPrismaDateTime: (value: Date) => value,
  getPostDataInclude: () => ({ user: true }),
  grantBadge: grantBadgeMock,
  invalidateAuraSignals: () => Promise.resolve(),
  postViewsCache: {},
  prisma: prismaMock,
  redis: {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
  },
  revokeBadge: revokeBadgeMock,
  tagCache: {},
  toPrismaDateTime: (value: Date) => value,
  unreadNotificationCache: {
    decrement: () => Promise.resolve(0),
    increment: () => Promise.resolve(1),
    reset: () => Promise.resolve(),
  },
  userCache: userCacheMock,
}));

const adminContext = {
  req: new Request("http://localhost:3001/api/trpc"),
  resHeaders: new Headers(),
  session: { id: "s1", userId: "admin1" },
  user: { id: "admin1", role: "admin" },
} as unknown as Context;

async function caller() {
  const { adminRouter } = await import("./index");
  return adminRouter.createCaller(adminContext);
}

beforeEach(() => {
  mockAdminCount.mockClear();
  mockCurrentUser.mockClear();
  mockUpdateUser.mockClear();
  mockUpdateAndCount.mockClear();
  mockDeleteAndCount.mockClear();
  mockFindAdmins.mockClear();
  mockTotalUsers.mockClear();
  mockTotalPosts.mockClear();
  mockTotalAura.mockClear();
  mockTopUsers.mockClear();
  mockOauthGroups.mockClear();
  mockSessionRows.mockClear();
  mockRegistrationRows.mockClear();
  prismaMock.transaction.mockClear();
  prismaMock.transaction.mockImplementation((fn) => fn(prismaMock));
  mockWhereAggregateResults = [];
  mockAdminCount.mockReturnValue(0);
  mockCurrentUser.mockReturnValue(null);
  mockUpdateUser.mockResolvedValue({ id: "u" });
  mockUpdateAndCount.mockReturnValue(1);
  mockDeleteAndCount.mockReturnValue(1);
  mockFindAdmins.mockReturnValue([]);
  mockTotalUsers.mockReturnValue(0);
  mockTotalPosts.mockReturnValue(0);
  mockTotalAura.mockReturnValue(0);
  mockTopUsers.mockReturnValue([]);
  mockOauthGroups.mockReturnValue([]);
  mockSessionRows.mockReturnValue([]);
  mockRegistrationRows.mockReturnValue([]);
  userCacheMock.checkRateLimit.mockClear();
  userCacheMock.checkRateLimit.mockResolvedValue({
    allowed: true,
    resetTime: 0,
  });
  grantBadgeMock.mockClear();
  grantBadgeMock.mockImplementation(() => Promise.resolve(true));
  revokeBadgeMock.mockClear();
  revokeBadgeMock.mockImplementation(() => Promise.resolve(true));
  userCacheMock.getAnalytics.mockClear();
  userCacheMock.getAnalytics.mockResolvedValue(null);
  userCacheMock.getUserStats.mockClear();
  userCacheMock.getUserStats.mockResolvedValue(null);
  userCacheMock.setAnalytics.mockClear();
  userCacheMock.setAnalytics.mockResolvedValue();
  userCacheMock.setUserStats.mockClear();
  userCacheMock.setUserStats.mockResolvedValue();
});

describe("admin setRole hard rules", () => {
  test("rejects promoting a second admin", async () => {
    mockAdminCount.mockReturnValue(1);

    const trpc = await caller();
    const promise = trpc.setRole({ role: "admin", userId: "u2" });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test("rejects demoting the last admin", async () => {
    mockCurrentUser.mockReturnValue({ role: "admin" });

    const trpc = await caller();
    const promise = trpc.setRole({ role: "user", userId: "admin1" });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test("allows promoting when no admin exists yet", async () => {
    mockAdminCount.mockReturnValue(0);

    const trpc = await caller();
    await trpc.setRole({ role: "admin", userId: "u2" });

    expect(mockUpdateUser).toHaveBeenCalledWith({ role: "admin" });
  });
});

describe("admin bulkUpdateUsers / updateUser role guards", () => {
  test("bulkUpdateUsers rejects promoting a second admin", async () => {
    mockAdminCount.mockReturnValue(1);

    const trpc = await caller();
    const promise = trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "admin" },
      userIds: ["u2"],
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("bulkUpdateUsers rejects promoting more than one user at once", async () => {
    const trpc = await caller();
    const promise = trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "admin" },
      userIds: ["u2", "u3"],
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("bulkUpdateUsers rejects demoting every current admin", async () => {
    mockFindAdmins.mockReturnValue([{ id: "admin1" }]);

    const trpc = await caller();
    const promise = trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "user" },
      userIds: ["admin1"],
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("bulkUpdateUsers allows demoting a non-admin or when other admins remain", async () => {
    mockFindAdmins.mockReturnValue([{ id: "admin1" }, { id: "admin2" }]);

    const trpc = await caller();
    await trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "user" },
      userIds: ["admin1"],
    });

    expect(mockUpdateAndCount).toHaveBeenCalledWith({ role: "user" });
  });

  test("updateUser rejects demoting the last admin", async () => {
    mockCurrentUser.mockReturnValue({ role: "admin" });
    mockAdminCount.mockReturnValue(0);

    const trpc = await caller();
    const promise = trpc.updateUser({
      data: { role: "user" },
      userId: "admin1",
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe("admin analytics", () => {
  test("builds provider, activity, and overview metrics with ORM queries", async () => {
    mockTotalUsers.mockReturnValue(4);
    mockTotalPosts.mockReturnValue(5);
    mockTotalAura.mockReturnValue(100);
    mockWhereAggregateResults = [2, 1, 2];
    mockOauthGroups.mockReturnValue([
      { count: 1, googleId: null, redditId: null },
      { count: 2, googleId: "google-1", redditId: null },
      { count: 1, googleId: null, redditId: "reddit-1" },
    ]);
    mockTopUsers.mockReturnValue([
      { aura: 50, displayName: "Top", id: "u1", username: "top" },
    ]);
    mockSessionRows.mockReturnValue([
      { createdAt: new Date("2026-09-24T10:15:00Z") },
      { createdAt: new Date("2026-09-24T10:45:00Z") },
      { createdAt: new Date("2026-09-24T09:15:00Z") },
    ]);
    const trpc = await caller();

    const result = await trpc.getAnalytics({ timeframe: "30d" });

    expect(result).toEqual({
      oauthBreakdown: [
        { count: 2, provider: "google" },
        { count: 1, provider: "email" },
        { count: 1, provider: "reddit" },
      ],
      overview: {
        activeUsers: 1,
        newUsers: 2,
        totalAura: 100,
        totalPosts: 5,
        totalUsers: 4,
        verificationRate: 50,
        verifiedUsers: 2,
      },
      topUsersByAura: [
        { aura: 50, displayName: "Top", id: "u1", username: "top" },
      ],
      userActivityByHour: [
        { count: 1, hour: 9 },
        { count: 2, hour: 10 },
      ],
    });
    expect(userCacheMock.setAnalytics).toHaveBeenCalledWith("30d", result);
  });

  test("groups registration dates in sorted order", async () => {
    mockRegistrationRows.mockReturnValue([
      { createdAt: new Date("2026-09-23T12:00:00Z") },
      { createdAt: new Date("2026-09-24T12:00:00Z") },
      { createdAt: new Date("2026-09-24T08:00:00Z") },
    ]);
    const trpc = await caller();

    const result = await trpc.getRegistrationTrends({ days: 7 });

    expect(result).toEqual([
      { count: 1, date: "2026-09-23" },
      { count: 2, date: "2026-09-24" },
    ]);
  });
});

describe("admin transaction conflicts", () => {
  test("retries a serializable role-change conflict", async () => {
    mockCurrentUser.mockReturnValue({ role: "user" });
    const conflict = Object.assign(new Error("serialization failed"), {
      sqlState: "40001",
    });
    prismaMock.transaction.mockImplementationOnce(() =>
      Promise.reject(conflict)
    );
    const trpc = await caller();

    await trpc.setRole({ role: "admin", userId: "u2" });

    expect(prismaMock.transaction).toHaveBeenCalledTimes(2);
    expect(mockUpdateAndCount).toHaveBeenCalledWith({ role: "admin" });
  });
});

describe("admin setBadge hard rules", () => {
  test("surfaces the single-author rule as a CONFLICT error", async () => {
    grantBadgeMock.mockImplementation(() => {
      throw new BadgeLimitError("Only one author is allowed for the app.");
    });

    const trpc = await caller();
    const promise = trpc.setBadge({
      badge: "author",
      grant: true,
      userId: "u2",
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(grantBadgeMock).toHaveBeenCalledWith("u2", "author");
  });

  test("grants a badge and invalidates caches", async () => {
    const trpc = await caller();
    const result = await trpc.setBadge({
      badge: "dev",
      grant: true,
      userId: "u2",
    });

    expect(result).toEqual({ changed: true, success: true });
    expect(userCacheMock.invalidateUserDetail).toHaveBeenCalledWith("u2");
  });

  test("revokes a badge", async () => {
    const trpc = await caller();
    await trpc.setBadge({ badge: "early", grant: false, userId: "u2" });

    expect(revokeBadgeMock).toHaveBeenCalledWith("u2", "early");
  });
});
