import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("share stream flush", () => {
  const executedArgs: string[] = [];

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

  const upsertCalls: unknown[] = [];
  const milestoneState = {
    auraLogs: [] as Record<string, unknown>[],
    postUpdates: [] as Record<string, unknown>[],
    userUpdates: [] as { id: string; increment: number }[],
  };

  // Configurable fixtures for the milestone path; empty by default so the
  // plain flush tests exercise "no milestones crossed".
  let milestonePosts: {
    id: string;
    lastAwardedShareCount: number;
    userId: string;
  }[] = [];
  let shareTotals: { _sum: { shares: number | null }; postId: string }[] = [];

  const mockTx = {
    auraLog: {
      createMany: mock((args: { data: Record<string, unknown>[] }) => {
        milestoneState.auraLogs.push(...args.data);
        return { count: args.data.length };
      }),
    },
    post: {
      update: mock((args: { data: Record<string, unknown> }) => {
        milestoneState.postUpdates.push(args.data);
      }),
    },
    user: {
      update: mock(
        (args: {
          data: { aura: { increment: number } };
          where: { id: string };
        }) => {
          milestoneState.userUpdates.push({
            id: args.where.id,
            increment: args.data.aura.increment,
          });
        }
      ),
    },
  };

  const mockPrisma = {
    $transaction: mock(async (ops: unknown[]) => {
      if (Array.isArray(ops)) {
        await Promise.all(ops as Promise<unknown>[]);
      } else if (typeof ops === "function") {
        await (ops as (tx: typeof mockTx) => Promise<unknown>)(mockTx);
      }
      return 1;
    }),
    post: {
      findMany: mock(() => milestonePosts),
    },
    shareStats: {
      groupBy: mock(() => shareTotals),
      upsert: mock((args: unknown) => {
        upsertCalls.push(args);
        return { id: "share-1" };
      }),
    },
  };

  mock.module("@asm/db", () => ({
    SHARE_CONSUMER_PREFIX: "share-worker",
    SHARE_GROUP: "share-flush",
    SHARE_STREAM: "share:stream",
    // Faithful tier math matching SHARE_MILESTONE_TIERS: the flush worker
    // awards share milestones through it.
    computeShareMilestoneAura: (
      lastAwardedShareCount: number,
      newTotalShares: number
    ) => {
      let aura = 0;
      let tiersCrossed = 0;
      for (const tier of [
        { aura: 10, threshold: 25 },
        { aura: 50, threshold: 250 },
      ]) {
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
    upsertCalls.length = 0;
    milestonePosts = [];
    shareTotals = [];
    milestoneState.auraLogs.length = 0;
    milestoneState.postUpdates.length = 0;
    milestoneState.userUpdates.length = 0;
    mockExec.mockClear();
    mockPrisma.$transaction.mockClear();
    mockPrisma.shareStats.upsert.mockClear();
    mockTx.auraLog.createMany.mockClear();
    mockTx.post.update.mockClear();
    mockTx.user.update.mockClear();
    mockRedis.xack.mockClear();
  });

  test("flushShareDeltas accumulates shares and clicks from counters", async () => {
    const { flushShareDeltas } = await import("./share-flush");

    const result = await flushShareDeltas([
      { platform: "twitter", postId: "post-1" },
    ]);

    expect(executedArgs).toEqual([
      "share:stats:post-1:twitter",
      "share:clicks:post-1:twitter",
    ]);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.shareStats.upsert).toHaveBeenCalledTimes(1);

    const upsert = upsertCalls[0] as {
      where: { postId_platform: { postId: string; platform: string } };
      create: {
        postId: string;
        platform: string;
        shares: number;
        clicks: number;
      };
      update: { shares: { increment: number }; clicks: { increment: number } };
    };
    expect(upsert.where.postId_platform).toEqual({
      platform: "twitter",
      postId: "post-1",
    });
    expect(upsert.create).toEqual({
      clicks: 2,
      platform: "twitter",
      postId: "post-1",
      shares: 3,
    });
    expect(upsert.update).toEqual({
      clicks: { increment: 2 },
      shares: { increment: 3 },
    });

    expect(result).toBe(1);
  });

  test("flushShareDeltas returns 0 when no counters exist", async () => {
    mockExec.mockResolvedValueOnce([
      [null, null],
      [null, null],
    ]);
    const { flushShareDeltas } = await import("./share-flush");

    const result = await flushShareDeltas([
      { platform: "twitter", postId: "post-1" },
    ]);

    expect(result).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test("crossing a share milestone awards the author and ledgers it", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "30"],
      [null, "0"],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 0, userId: "author-1" },
    ];
    shareTotals = [{ _sum: { shares: 30 }, postId: "post-1" }];

    const { flushShareDeltas } = await import("./share-flush");
    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(milestoneState.userUpdates).toEqual([
      { id: "author-1", increment: 10 },
    ]);
    expect(milestoneState.postUpdates).toEqual([{ lastAwardedShareCount: 30 }]);
    expect(milestoneState.auraLogs).toHaveLength(1);
    expect(milestoneState.auraLogs[0]).toMatchObject({
      amount: 10,
      issuerId: "author-1",
      postId: "post-1",
      targetUserId: "author-1",
      type: "SHARE_MILESTONE",
      userId: "author-1",
    });
  });

  test("no milestone fires below the first tier", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "5"],
      [null, null],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 0, userId: "author-1" },
    ];
    shareTotals = [{ _sum: { shares: 5 }, postId: "post-1" }];

    const { flushShareDeltas } = await import("./share-flush");
    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(milestoneState.userUpdates).toHaveLength(0);
    expect(milestoneState.auraLogs).toHaveLength(0);
  });
});
