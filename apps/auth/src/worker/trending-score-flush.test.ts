import { beforeEach, describe, expect, mock, test } from "bun:test";

interface PostRow {
  _count: { bookmarks: number; comments: number };
  aura: number;
  createdAt: Date;
  id: string;
  viewCount: number;
}

interface FindManyArgs {
  cursor?: { id: string };
  orderBy: { id: string };
  select: Record<string, unknown>;
  skip?: number;
  take: number;
  where: { createdAt: { gte: Date } };
}

// Deterministic stand-in for the real scorer (the module is mocked here, so
// the real implementation never loads). Scores are just double the aura.
const fakeComputeTrendingScore = (input: { aura: number }): number =>
  input.aura * 2;

const stubPost = (id: string): PostRow => ({
  _count: { bookmarks: 2, comments: 3 },
  aura: 5,
  createdAt: new Date("2026-08-20T00:00:00Z"),
  id,
  viewCount: 10,
});

describe("flushTrendingScores", () => {
  const findManyCalls: FindManyArgs[] = [];
  // Queue of batches the mocked findMany hands out, one entry per call.
  let batchedPosts: PostRow[][] = [];

  const mockFindMany = mock((args: FindManyArgs): PostRow[] => {
    findManyCalls.push(args);
    return batchedPosts.shift() ?? [];
  });

  const executed: { args: unknown[]; query: string }[] = [];

  const mockExecutedRaw = mock(
    (query: TemplateStringsArray, ...args: unknown[]) => {
      executed.push({ args, query: String(query[0]) });
      return args.length;
    }
  );

  const mockPrisma = {
    $executeRaw: mockExecutedRaw,
    post: { findMany: mockFindMany },
  };

  mock.module("@asm/db", () => ({
    computeTrendingScore: fakeComputeTrendingScore,
    prisma: mockPrisma,
  }));

  beforeEach(() => {
    findManyCalls.length = 0;
    executed.length = 0;
    batchedPosts = [];
    mockFindMany.mockClear();
    mockExecutedRaw.mockClear();
  });

  test("updates scores for a single partial batch", async () => {
    batchedPosts = [[stubPost("post-1"), stubPost("post-2")]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockExecutedRaw).toHaveBeenCalledTimes(1);

    const [update] = executed;
    expect(update?.query).toContain("UPDATE posts");
    const idsParam = (update?.args[0] ?? []) as string[];
    expect(idsParam).toContain("post-1");
    expect(idsParam).toContain("post-2");

    const scoresParam = (update?.args[1] ?? []) as number[];
    expect(scoresParam).toEqual([10, 10]); // fake scorer: aura * 2

    expect(result).toEqual({ batches: 1, postsUpdated: 2 });
  });

  test("paginates in keyset batches until exhausted", async () => {
    batchedPosts = [
      Array.from({ length: 500 }, (_, index) => stubPost(`p${index}`)),
      [stubPost("p500")],
    ];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(mockFindMany).toHaveBeenCalledTimes(2);
    expect(mockExecutedRaw).toHaveBeenCalledTimes(2);

    const [, secondCall] = findManyCalls;
    expect(secondCall?.cursor).toEqual({ id: "p499" });
    expect(secondCall?.skip).toBe(1);

    expect(result).toEqual({ batches: 2, postsUpdated: 501 });
  });

  test("scopes the scan to the recent window", async () => {
    batchedPosts = [[]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const now = new Date("2026-08-23T12:00:00Z");
    await flushTrendingScores(undefined, now);

    const [firstCall] = findManyCalls;
    expect(firstCall?.where.createdAt.gte).toEqual(
      new Date("2026-08-16T12:00:00Z")
    );
    expect(firstCall?.where.createdAt.gte.getTime()).toBe(
      now.getTime() - 7 * 24 * 60 * 60 * 1000
    );
  });

  test("does nothing when the window is empty", async () => {
    batchedPosts = [[]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(mockExecutedRaw).not.toHaveBeenCalled();
    expect(result).toEqual({ batches: 0, postsUpdated: 0 });
  });
});
