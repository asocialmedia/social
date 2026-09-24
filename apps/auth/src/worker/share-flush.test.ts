import { beforeEach, describe, expect, mock, test } from "bun:test";

import { SHARE_MILESTONE_TIERS } from "../../../../packages/db/src/aura/config";

describe("share stream flush", () => {
  const executedArgs: string[] = [];
  const shareStats: {
    clicks: number;
    platform: string;
    postId: string;
    shares: number;
  }[] = [];
  const userUpdates: { aura: number; id: string }[] = [];
  const milestoneState = {
    auraLogs: [] as Record<string, unknown>[],
    postUpdates: [] as Record<string, unknown>[],
  };
  let milestonePosts: {
    id: string;
    lastAwardedShareCount: number;
    userId: string;
  }[] = [];
  let shareTotals: { postId: string; shares: number | null }[] = [];
  let casWins = true;
  let shareStatClaimFailures = 0;
  let userClaimFailures = 0;
  let userAura = 20;

  const mockExec = mock((): Promise<[null, string | null][]> =>
    Promise.resolve([
      [null, "3"],
      [null, "2"],
      [null, null],
      [null, null],
    ])
  );
  const mockRedis = {
    pipeline: () => ({
      exec: mockExec,
      getdel: (key: string) => {
        executedArgs.push(key);
      },
    }),
    xack: mock(() => 1),
  };
  const mockShareStatsCreate = mock(
    (row: {
      clicks: number;
      platform: string;
      postId: string;
      shares: number;
    }) => {
      shareStats.push(row);
      return Promise.resolve(row);
    }
  );
  const mockShareStatsUpdate = mock(
    (update: { clicks: number; shares: number }) => {
      const [row] = shareStats;
      if (!row || shareStatClaimFailures > 0) {
        if (shareStatClaimFailures > 0) {
          shareStatClaimFailures -= 1;
        }
        return Promise.resolve(0);
      }
      row.clicks = update.clicks;
      row.shares = update.shares;
      return Promise.resolve(1);
    }
  );
  const mockPostFindMany = mock(() => milestonePosts);
  const mockPostUpdate = mock((data: { lastAwardedShareCount: number }) => {
    if (!casWins) {
      return Promise.resolve(0);
    }
    milestoneState.postUpdates.push({
      id: milestonePosts[0]?.id,
      ...data,
    });
    return Promise.resolve(1);
  });
  const mockUserUpdate = mock((update: { aura: number }) => {
    if (userClaimFailures > 0) {
      userClaimFailures -= 1;
      return Promise.resolve(0);
    }
    userAura = update.aura;
    userUpdates.push({ aura: update.aura, id: "author-1" });
    return Promise.resolve(1);
  });
  const mockAuraLogCreateAll = mock((rows: Record<string, unknown>[]) => {
    milestoneState.auraLogs.push(...rows);
    return Promise.resolve([]);
  });
  const mockTransaction = mock(
    async (operation: (tx: typeof mockTx) => Promise<unknown>) => {
      await operation(mockTx);
    }
  );

  const mockShareStats = {
    create: mockShareStatsCreate,
    select: () => ({
      where: () => ({
        first: () => shareStats[0] ?? null,
      }),
    }),
    where: () => ({
      groupBy: () => ({
        aggregate: () =>
          shareTotals.map((row) => ({
            postId: row.postId,
            shares: row.shares,
          })),
      }),
      updateAndCount: mockShareStatsUpdate,
    }),
  };
  const mockPosts = {
    select: () => ({ where: () => ({ all: mockPostFindMany }) }),
    where: () => ({ updateAndCount: mockPostUpdate }),
  };
  const mockUsers = {
    select: () => ({
      where: () => ({ first: () => ({ aura: userAura }) }),
    }),
    where: () => ({ updateAndCount: mockUserUpdate }),
  };
  const mockTx = {
    orm: {
      public: {
        AuraLogs: { createAll: mockAuraLogCreateAll },
        Posts: mockPosts,
        ShareStats: mockShareStats,
        Users: mockUsers,
      },
    },
  };
  const mockPrisma = {
    orm: mockTx.orm,
    transaction: mockTransaction,
  };

  mock.module("@asm/db", () => ({
    SHARE_CONSUMER_PREFIX: "share-worker",
    SHARE_GROUP: "share-flush",
    SHARE_STREAM: "share:stream",
    and: (...expressions: unknown[]) => expressions,
    computeShareMilestoneAura: (
      lastAwardedShareCount: number,
      newTotalShares: number
    ) => {
      let aura = 0;
      let tiersCrossed = 0;
      for (const tier of SHARE_MILESTONE_TIERS) {
        if (
          lastAwardedShareCount < tier.threshold &&
          newTotalShares >= tier.threshold
        ) {
          aura += tier.aura;
          tiersCrossed += 1;
        }
      }
      return { aura, tiersCrossed };
    },
    getBlockingRedisClient: () => mockRedis,
    prisma: mockPrisma,
    redis: mockRedis,
  }));

  beforeEach(() => {
    executedArgs.length = 0;
    shareStats.length = 0;
    userUpdates.length = 0;
    milestoneState.auraLogs.length = 0;
    milestoneState.postUpdates.length = 0;
    milestonePosts = [];
    shareTotals = [];
    casWins = true;
    shareStatClaimFailures = 0;
    userClaimFailures = 0;
    userAura = 20;
    mockExec.mockClear();
    mockTransaction.mockClear();
    mockShareStatsCreate.mockClear();
    mockShareStatsUpdate.mockClear();
    mockPostFindMany.mockClear();
    mockPostUpdate.mockClear();
    mockUserUpdate.mockClear();
    mockAuraLogCreateAll.mockClear();
    mockRedis.xack.mockClear();
  });

  test("creates share stats from buffered counters", async () => {
    const { flushShareDeltas } = await import("./share-flush");

    const result = await flushShareDeltas([
      { platform: "twitter", postId: "post-1" },
    ]);

    expect(executedArgs).toEqual([
      "share:stats:post-1:twitter",
      "share:clicks:post-1:twitter",
    ]);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockShareStatsCreate).toHaveBeenCalledTimes(1);
    expect(shareStats).toEqual([
      {
        clicks: 2,
        platform: "twitter",
        postId: "post-1",
        shares: 3,
      },
    ]);
    expect(result).toBe(1);
  });

  test("adds buffered counters to existing share stats", async () => {
    shareStats.push({
      clicks: 4,
      platform: "twitter",
      postId: "post-1",
      shares: 7,
    });
    const { flushShareDeltas } = await import("./share-flush");

    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(mockShareStatsUpdate).toHaveBeenCalledWith({
      clicks: 6,
      shares: 10,
    });
    expect(shareStats[0]).toMatchObject({ clicks: 6, shares: 10 });
  });

  test("retries a share stats compare-and-set conflict", async () => {
    shareStats.push({
      clicks: 4,
      platform: "twitter",
      postId: "post-1",
      shares: 7,
    });
    shareStatClaimFailures = 1;
    const { flushShareDeltas } = await import("./share-flush");

    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(mockTransaction).toHaveBeenCalledTimes(3);
    expect(shareStats[0]).toMatchObject({ clicks: 6, shares: 10 });
  });

  test("returns 0 when no counters exist", async () => {
    mockExec.mockResolvedValueOnce([
      [null, null],
      [null, null],
    ]);
    const { flushShareDeltas } = await import("./share-flush");

    const result = await flushShareDeltas([
      { platform: "twitter", postId: "post-1" },
    ]);

    expect(result).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("awards and ledgers a crossed share milestone", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "30"],
      [null, "0"],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 0, userId: "author-1" },
    ];
    shareTotals = [{ postId: "post-1", shares: 30 }];
    const { flushShareDeltas } = await import("./share-flush");

    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(userUpdates).toEqual([{ aura: 30, id: "author-1" }]);
    expect(milestoneState.postUpdates).toEqual([
      { id: "post-1", lastAwardedShareCount: 30 },
    ]);
    expect(milestoneState.auraLogs).toEqual([
      {
        _type: "SHARE_MILESTONE",
        amount: 10,
        issuerId: "author-1",
        postId: "post-1",
        targetUserId: "author-1",
        userId: "author-1",
      },
    ]);
  });

  test("no milestone fires below the first tier", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "5"],
      [null, null],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 0, userId: "author-1" },
    ];
    shareTotals = [{ postId: "post-1", shares: 5 }];
    const { flushShareDeltas } = await import("./share-flush");

    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(userUpdates).toHaveLength(0);
    expect(milestoneState.auraLogs).toHaveLength(0);
  });

  test("a lost post claim skips payout and ledger", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "30"],
      [null, null],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 10, userId: "author-1" },
    ];
    shareTotals = [{ postId: "post-1", shares: 30 }];
    casWins = false;
    const { flushShareDeltas } = await import("./share-flush");

    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(userUpdates).toHaveLength(0);
    expect(milestoneState.auraLogs).toHaveLength(0);
    expect(milestoneState.postUpdates).toHaveLength(0);
  });

  test("retries a user aura compare-and-set conflict", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "30"],
      [null, "0"],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 0, userId: "author-1" },
    ];
    shareTotals = [{ postId: "post-1", shares: 30 }];
    userClaimFailures = 1;
    const { flushShareDeltas } = await import("./share-flush");

    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(mockTransaction).toHaveBeenCalledTimes(3);
    expect(userUpdates).toEqual([{ aura: 30, id: "author-1" }]);
    expect(milestoneState.auraLogs).toHaveLength(1);
  });
});
