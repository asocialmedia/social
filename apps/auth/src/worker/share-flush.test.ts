import { beforeEach, describe, expect, mock, test } from "bun:test";

// Imported from the aura config source: the @asm/db barrel is mocked below,
// so the mock cannot re-export its real values. Keeps tier math in one place.
import { SHARE_MILESTONE_TIERS } from "../../../../packages/db/src/aura/config";

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

  // Set to false to simulate a lost compare-and-set race on every post.
  let casWins = true;

  const mockTx = {
    auraLog: {
      // CAS flow writes one ledger row per claimed award.
      create: mock((args: { data: Record<string, unknown> }) => {
        milestoneState.auraLogs.push(args.data);
        return Promise.resolve({});
      }),
      createMany: mock((args: { data: Record<string, unknown>[] }) => {
        milestoneState.auraLogs.push(...args.data);
        return { count: args.data.length };
      }),
    },
    post: {
      findMany: mock(() => milestonePosts),
      // Mirrors the real CAS semantics: matches only when the row still
      // carries the previously read awarded count.
      updateMany: mock(
        (args: {
          data: { lastAwardedShareCount: number };
          where: { id: string; lastAwardedShareCount: number };
        }) => {
          if (!casWins) {
            return Promise.resolve({ count: 0 });
          }
          milestoneState.postUpdates.push({
            id: args.where.id,
            ...args.data,
          });
          return Promise.resolve({ count: 1 });
        }
      ),
    },
    shareStats: {
      groupBy: mock(() => shareTotals),
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
    shareStats: {
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
    // Real tier table from config; no duplicated milestone literals here.
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
    upsertCalls.length = 0;
    milestonePosts = [];
    shareTotals = [];
    milestoneState.auraLogs.length = 0;
    milestoneState.postUpdates.length = 0;
    milestoneState.userUpdates.length = 0;
    casWins = true;
    mockExec.mockClear();
    mockPrisma.$transaction.mockClear();
    mockPrisma.shareStats.upsert.mockClear();
    mockTx.auraLog.create.mockClear();
    mockTx.auraLog.createMany.mockClear();
    mockTx.post.updateMany.mockClear();
    mockTx.post.findMany.mockClear();
    mockTx.shareStats.groupBy.mockClear();
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
    // One transaction for the shareStats upserts plus one for the
    // milestone claim/payout pass.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
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
    expect(milestoneState.postUpdates).toEqual([
      { id: "post-1", lastAwardedShareCount: 30 },
    ]);
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

  test("a lost compare-and-set race skips payout and ledger", async () => {
    mockExec.mockResolvedValueOnce([
      [null, "30"],
      [null, null],
    ]);
    milestonePosts = [
      { id: "post-1", lastAwardedShareCount: 10, userId: "author-1" },
    ];
    shareTotals = [{ _sum: { shares: 30 }, postId: "post-1" }];
    casWins = false;

    const { flushShareDeltas } = await import("./share-flush");
    await flushShareDeltas([{ platform: "twitter", postId: "post-1" }]);

    expect(milestoneState.userUpdates).toHaveLength(0);
    expect(milestoneState.auraLogs).toHaveLength(0);
    expect(milestoneState.postUpdates).toHaveLength(0);
  });
});
