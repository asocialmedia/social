import { beforeEach, describe, expect, mock, test } from "bun:test";
import { computeViewAura } from "./view-flush";

describe("computeViewAura", () => {
  test("no aura before the 50-view milestone", () => {
    const result = computeViewAura(0, 49);
    expect(result.aura).toBe(0);
    expect(result.lastAwardedViewCount).toBe(49);
  });

  test("awards 10 aura when crossing 50 views", () => {
    const result = computeViewAura(0, 50);
    expect(result.aura).toBe(10);
    expect(result.lastAwardedViewCount).toBe(50);
  });

  test("awards aura per 50-view milestone crossed", () => {
    const result = computeViewAura(0, 130);
    expect(result.aura).toBe(20); // 50, 100 = 2 milestones
  });

  test("awards 100 aura at 1000 views", () => {
    const result = computeViewAura(0, 1000);
    // 20 fifties (200) + 1 thousand (100) = 300
    expect(result.aura).toBe(300);
  });

  test("does not re-award already-passed milestones", () => {
    const result = computeViewAura(120, 200);
    // lastAwarded crossed 50 and 100; new count crosses 150 and 200 = 2 more
    expect(result.aura).toBe(20);
  });

  test("awards nothing when no milestone crossed", () => {
    const result = computeViewAura(200, 210);
    expect(result.aura).toBe(0);
  });
});

describe("flushViewDeltas", () => {
  const getdelCalls: string[] = [];

  const mockExec = mock(async () => [
    [null, "12"],
    [null, null],
  ]);

  const mockRedis = {
    pipeline: () => ({
      getdel: (key: string) => {
        getdelCalls.push(key);
      },
      srem: () => undefined,
      exec: mockExec,
    }),
  };

  const executed: unknown[] = [];

  const mockTx = {
    $executeRaw: (query: TemplateStringsArray, ...args: unknown[]) => {
      executed.push({ query: query[0], args });
    },
    auraLog: {
      createMany: mock(() => ({ count: 0 })),
    },
  };

  const mockPrisma = {
    post: {
      findMany: mock(async () => [
        {
          id: "post-1",
          userId: "user-1",
          viewCount: 40,
          lastAwardedViewCount: 0,
        },
      ]),
    },
    $transaction: async (
      fn: (tx: typeof mockTx) => Promise<unknown>
    ): Promise<unknown> => fn(mockTx),
  };

  mock.module("@asm/db", () => ({
    prisma: mockPrisma,
    redis: mockRedis,
    getBlockingRedisClient: () => mockRedis,
    POST_VIEWS_KEY_PREFIX: "post:views:",
    POST_VIEWS_SET: "posts:with:views",
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
    // post-1 goes 40 -> 52 (12 new views), crossing 50 once = +10 aura
    expect(result.auraAwarded).toBe(10);

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
