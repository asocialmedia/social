import { beforeEach, describe, expect, mock, test } from "bun:test";

interface PostRow {
  _count: { bookmarks: number; comments: number };
  aura: number;
  createdAt: Date;
  id: string;
  viewCount: number;
}

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
  let batchedPosts: PostRow[][] = [];
  const cursorValues: (string | undefined)[] = [];
  const dateConversions: Date[] = [];

  const mockFindMany = mock((): PostRow[] => batchedPosts.shift() ?? []);

  const scoreUpdates: { id: string; trendingScore: number }[] = [];
  const mockPostUpdate = mock(
    (update: { id: string; trendingScore: number }) => {
      scoreUpdates.push(update);
      return Promise.resolve(update);
    }
  );

  let queryCursor: string | undefined;
  const query = {
    all: () => mockFindMany(),
    cursor: (value: { id: string }) => {
      queryCursor = value.id;
      cursorValues.push(queryCursor);
      return query;
    },
    include: () => query,
    limit: () => query,
    orderBy: () => query,
    where: (predicate: (accessor: object) => unknown) => {
      const accessor = new Proxy(
        {},
        {
          get: () => ({
            gte: () => ({}),
            isNull: () => ({}),
          }),
        }
      );
      predicate(accessor);
      return query;
    },
  };
  const mockPublishSnapshot = mock(
    (entries: { id: string; score: number }[]) => entries.length
  );

  const mockOrm = {
    public: {
      Posts: {
        select: () => ({
          include: () => query,
        }),
        where: (value: { id: string }) => ({
          update: (update: { trendingScore: number }) =>
            mockPostUpdate({
              id: value.id,
              trendingScore: update.trendingScore,
            }),
        }),
      },
    },
  };
  const mockPrisma = {
    orm: mockOrm,
    transaction: (
      operation: (tx: { orm: typeof mockOrm }) => Promise<unknown>
    ) => operation({ orm: mockOrm }),
  };

  mock.module("@asm/db", () => ({
    and: (...expressions: unknown[]) => expressions,
    computeTrendingScore: fakeComputeTrendingScore,
    fromPrismaDateTime: (value: Date) => value,
    prisma: mockPrisma,
    publishTrendingSnapshot: mockPublishSnapshot,
    toPrismaDateTime: (value: Date) => {
      dateConversions.push(value);
      return value;
    },
  }));

  beforeEach(() => {
    scoreUpdates.length = 0;
    batchedPosts = [];
    cursorValues.length = 0;
    dateConversions.length = 0;
    queryCursor = undefined;
    mockFindMany.mockClear();
    mockPostUpdate.mockClear();
    mockPublishSnapshot.mockClear();
    mockPublishSnapshot.mockImplementation(
      (entries: { id: string; score: number }[]) => entries.length
    );
  });

  test("updates scores for a single partial batch", async () => {
    batchedPosts = [[stubPost("post-1"), stubPost("post-2")]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockPostUpdate).toHaveBeenCalledTimes(2);
    expect(scoreUpdates).toEqual([
      { id: "post-1", trendingScore: 10 },
      { id: "post-2", trendingScore: 10 },
    ]);

    expect(result).toEqual({
      batches: 1,
      postsUpdated: 2,
      publishedToSnapshot: 2,
    });
  });

  test("paginates in keyset batches until exhausted", async () => {
    batchedPosts = [
      Array.from({ length: 500 }, (_, index) => stubPost(`p${index}`)),
      [stubPost("p500")],
    ];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(mockFindMany).toHaveBeenCalledTimes(2);
    expect(mockPostUpdate).toHaveBeenCalledTimes(501);
    expect(cursorValues).toEqual(["p499"]);

    // All 501 scored posts reach the snapshot publisher in order.
    expect(mockPublishSnapshot).toHaveBeenCalledTimes(1);
    const publishedArg = mockPublishSnapshot.mock.calls[0]?.[0] ?? [];
    expect(publishedArg[0]).toEqual({ id: "p0", score: 10 });
    expect(publishedArg.at(-1)).toEqual({ id: "p500", score: 10 });

    expect(result).toEqual({
      batches: 2,
      postsUpdated: 501,
      publishedToSnapshot: 501,
    });
  });

  test("scopes the scan to the recent window", async () => {
    batchedPosts = [[]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const now = new Date("2026-08-23T12:00:00Z");
    await flushTrendingScores(undefined, now);

    expect(dateConversions[0]?.getTime()).toBe(
      now.getTime() - 7 * 24 * 60 * 60 * 1000
    );
  });

  test("does nothing when the window is empty", async () => {
    batchedPosts = [[]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(mockPostUpdate).not.toHaveBeenCalled();
    // The publisher itself no-ops on an empty window; the flush hands it the
    // (empty) recompute regardless.
    expect(mockPublishSnapshot).toHaveBeenCalledWith([]);
    expect(result).toEqual({
      batches: 0,
      postsUpdated: 0,
      publishedToSnapshot: 0,
    });
  });

  test("keeps the flush successful when the snapshot publish fails", async () => {
    batchedPosts = [[stubPost("post-1")]];
    mockPublishSnapshot.mockImplementationOnce(() => {
      throw new Error("redis down");
    });

    const { flushTrendingScores } = await import("./trending-score-flush");

    const result = await flushTrendingScores();

    expect(result.postsUpdated).toBe(1);
    expect(result.publishedToSnapshot).toBe(0);
  });

  test("publishes nothing when there is no snapshot yet", async () => {
    batchedPosts = [[stubPost("post-1")]];

    const { flushTrendingScores } = await import("./trending-score-flush");

    await flushTrendingScores();

    expect(mockPublishSnapshot).toHaveBeenCalledWith([
      { id: "post-1", score: 10 },
    ]);
  });
});
