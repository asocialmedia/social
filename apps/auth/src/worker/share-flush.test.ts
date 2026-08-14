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

  const mockPrisma = {
    $transaction: mock(async (ops: unknown[]) => {
      await Promise.all(ops as Promise<unknown>[]);
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
    getBlockingRedisClient: () => mockRedis,
    prisma: mockPrisma,
    redis: mockRedis,
  }));

  beforeEach(() => {
    executedArgs.length = 0;
    upsertCalls.length = 0;
    mockExec.mockClear();
    mockPrisma.$transaction.mockClear();
    mockPrisma.shareStats.upsert.mockClear();
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
});
