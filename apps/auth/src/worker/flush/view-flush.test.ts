import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("view flush", () => {
  const getdelCalls: string[] = [];
  const postUpdates: Record<string, unknown>[] = [];
  const userUpdates: Record<string, unknown>[] = [];
  const auraLogs: Record<string, unknown>[] = [];
  let postClaimFailures = 0;
  let userClaimFailures = 0;

  const mockExec = mock(() => [
    [null, "12"],
    [null, null],
  ]);
  const mockPostUpdate = mock(() => {
    if (postClaimFailures > 0) {
      postClaimFailures -= 1;
      return Promise.resolve(0);
    }
    return Promise.resolve(1);
  });
  const mockUserUpdate = mock(() => {
    if (userClaimFailures > 0) {
      userClaimFailures -= 1;
      return Promise.resolve(0);
    }
    return Promise.resolve(1);
  });
  const mockCreateAll = mock((rows: Record<string, unknown>[]) => {
    auraLogs.push(...rows);
    return Promise.resolve([]);
  });
  const mockTransaction = mock(
    (operation: (tx: typeof mockTx) => Promise<unknown>) => operation(mockTx)
  );
  const mockRedis = {
    pipeline: () => ({
      exec: mockExec,
      getdel: (key: string) => {
        getdelCalls.push(key);
      },
      srem: () => {},
    }),
  };
  const mockPosts = {
    select: () => ({
      where: () => ({
        all: () => [
          {
            aura: 5,
            id: "post-1",
            lastAwardedViewCount: 0,
            userId: "user-1",
            viewCount: 40,
          },
        ],
      }),
    }),
    where: () => ({
      updateAndCount: (update: Record<string, unknown>) => {
        postUpdates.push(update);
        return mockPostUpdate();
      },
    }),
  };
  const mockUsers = {
    select: () => ({
      where: () => ({ first: () => ({ aura: 10 }) }),
    }),
    where: () => ({
      updateAndCount: (update: Record<string, unknown>) => {
        userUpdates.push(update);
        return mockUserUpdate();
      },
    }),
  };
  const mockTx = {
    orm: {
      public: {
        AuraLogs: { createAll: mockCreateAll },
        Posts: mockPosts,
        Users: mockUsers,
      },
    },
  };
  const mockPrisma = {
    orm: mockTx.orm,
    transaction: mockTransaction,
  };

  mock.module("@asm/db", () => ({
    POST_VIEWS_KEY_PREFIX: "post:views:",
    POST_VIEWS_SET: "posts:with:views",
    VIEWS_CONSUMER_PREFIX: "view-worker",
    VIEWS_GROUP: "view-flush",
    VIEWS_STREAM: "view:stream",
    and: (...expressions: unknown[]) => expressions,
    computeViewMilestoneAura: (lastAwarded: number, newTotal: number) => {
      let aura = Math.floor(newTotal / 10) - Math.floor(lastAwarded / 10);
      if (lastAwarded < 1000 && newTotal >= 1000) {
        aura += 100;
      }
      return { aura, lastAwardedViewCount: newTotal };
    },
    getBlockingRedisClient: () => mockRedis,
    prisma: mockPrisma,
    redis: mockRedis,
  }));

  describe("computeViewAura", () => {
    test("no aura before the first 10 views", async () => {
      const { computeViewAura } = await import("./view-flush");
      const result = computeViewAura(0, 9);
      expect(result.aura).toBe(0);
      expect(result.lastAwardedViewCount).toBe(9);
    });

    test("awards 1 aura when crossing 10 views", async () => {
      const { computeViewAura } = await import("./view-flush");
      const result = computeViewAura(0, 10);
      expect(result.aura).toBe(1);
      expect(result.lastAwardedViewCount).toBe(10);
    });

    test("awards aura per 10-view step crossed", async () => {
      const { computeViewAura } = await import("./view-flush");
      const result = computeViewAura(0, 130);
      expect(result.aura).toBe(13);
    });

    test("pays the 1K bonus alongside accrued steps at 1000 views", async () => {
      const { computeViewAura } = await import("./view-flush");
      const result = computeViewAura(0, 1000);
      expect(result.aura).toBe(200);
    });

    test("does not re-award already-passed milestones", async () => {
      const { computeViewAura } = await import("./view-flush");
      const result = computeViewAura(120, 200);
      expect(result.aura).toBe(8);
    });

    test("awards nothing when no milestone crossed", async () => {
      const { computeViewAura } = await import("./view-flush");
      const result = computeViewAura(200, 209);
      expect(result.aura).toBe(0);
    });
  });

  beforeEach(() => {
    getdelCalls.length = 0;
    postUpdates.length = 0;
    userUpdates.length = 0;
    auraLogs.length = 0;
    postClaimFailures = 0;
    userClaimFailures = 0;
    mockExec.mockClear();
    mockPostUpdate.mockClear();
    mockUserUpdate.mockClear();
    mockCreateAll.mockClear();
    mockTransaction.mockClear();
  });

  test("flushes deltas and awards view aura in one transaction", async () => {
    const { flushViewDeltas } = await import("./view-flush");
    const result = await flushViewDeltas(["post-1", "missing-post"]);

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(result.flushedPosts).toBe(1);
    expect(result.auraAwarded).toBe(5);
    expect(postUpdates).toEqual([
      {
        aura: 10,
        lastAwardedViewCount: 52,
        viewCount: 52,
      },
    ]);
    expect(userUpdates).toEqual([{ aura: 15 }]);
    expect(auraLogs).toEqual([
      {
        _type: "POST_VIEWS_MILESTONE",
        amount: 5,
        issuerId: "user-1",
        postId: "post-1",
        targetUserId: "user-1",
        userId: "user-1",
      },
    ]);
  });

  test("retries a failed post compare-and-set", async () => {
    postClaimFailures = 1;
    const { flushViewDeltas } = await import("./view-flush");
    const result = await flushViewDeltas(["post-1"]);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(result.flushedPosts).toBe(1);
    expect(mockCreateAll).toHaveBeenCalledTimes(1);
  });

  test("retries a failed user aura compare-and-set", async () => {
    userClaimFailures = 1;
    const { flushViewDeltas } = await import("./view-flush");
    const result = await flushViewDeltas(["post-1"]);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(result.auraAwarded).toBe(5);
    expect(mockCreateAll).toHaveBeenCalledTimes(1);
  });
});
