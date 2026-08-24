import { beforeEach, describe, expect, mock, test } from "bun:test";

import { computeViewAura } from "./view-flush";

describe("computeViewAura", () => {
  test("no aura before the first 10 views", () => {
    const result = computeViewAura(0, 9);
    expect(result.aura).toBe(0);
    expect(result.lastAwardedViewCount).toBe(9);
  });

  test("awards 1 aura when crossing 10 views", () => {
    const result = computeViewAura(0, 10);
    expect(result.aura).toBe(1);
    expect(result.lastAwardedViewCount).toBe(10);
  });

  test("awards aura per 10-view step crossed", () => {
    const result = computeViewAura(0, 130);
    expect(result.aura).toBe(13); // 13 full ten-view steps
  });

  test("pays the 1K bonus alongside accrued steps at 1000 views", () => {
    const result = computeViewAura(0, 1000);
    // 100 steps (100) + 1K bonus (100) = 200
    expect(result.aura).toBe(200);
  });

  test("does not re-award already-passed milestones", () => {
    const result = computeViewAura(120, 200);
    // lastAwarded covered steps through 120; new count adds 8 more steps
    expect(result.aura).toBe(8);
  });

  test("awards nothing when no milestone crossed", () => {
    const result = computeViewAura(200, 209);
    expect(result.aura).toBe(0);
  });
});

describe("flushViewDeltas", () => {
  const getdelCalls: string[] = [];

  const mockExec = mock(() => [
    [null, "12"],
    [null, null],
  ]);

  const mockRedis = {
    pipeline: () => ({
      exec: mockExec,
      getdel: (key: string) => {
        getdelCalls.push(key);
      },
      srem: () => {},
    }),
  };

  const executed: unknown[] = [];

  const mockTx = {
    $executeRaw: (query: TemplateStringsArray, ...args: unknown[]) => {
      executed.push({ args, query: query[0] });
    },
    auraLog: {
      createMany: mock(() => ({ count: 0 })),
    },
  };

  const mockPrisma = {
    $transaction: (
      fn: (tx: typeof mockTx) => Promise<unknown>
    ): Promise<unknown> => fn(mockTx),
    post: {
      findMany: mock(() => [
        {
          id: "post-1",
          lastAwardedViewCount: 0,
          userId: "user-1",
          viewCount: 40,
        },
      ]),
    },
  };

  mock.module("@asm/db", () => ({
    POST_VIEWS_KEY_PREFIX: "post:views:",
    POST_VIEWS_SET: "posts:with:views",
    getBlockingRedisClient: () => mockRedis,
    prisma: mockPrisma,
    redis: mockRedis,
  }));

  beforeEach(() => {
    getdelCalls.length = 0;
    executed.length = 0;
    mockExec.mockClear();
    mockTx.auraLog.createMany.mockClear();
  });

  test("flushes deltas and awards view aura in the same update", async () => {
    const { flushViewDeltas } = await import("./view-flush");

    const result = await flushViewDeltas(["post-1", "missing-post"]);

    // Only post-1 has a counter; missing-post has no counter value.
    expect(mockExec).toHaveBeenCalledTimes(2); // one pipeline for getdel, one for srem
    expect(result.flushedPosts).toBe(1);
    // post-1 goes 0-awarded -> 52 total views: five full 10-view steps = +5
    expect(result.auraAwarded).toBe(5);

    const postUpdate = executed.find(
      (entry): entry is { query: string; args: unknown[] } =>
        typeof entry === "object" &&
        entry !== null &&
        "query" in entry &&
        String((entry as { query: unknown }).query).includes("UPDATE posts")
    );
    expect(postUpdate).toBeDefined();
    const postIdsParam = (postUpdate?.args?.[0] ?? []) as string[];
    expect(postIdsParam).toContain("post-1");
  });
});
