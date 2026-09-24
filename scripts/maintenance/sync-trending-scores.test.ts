import { describe, expect, mock, test } from "bun:test";

interface MockPost {
  aura: number;
  bookmarks: { total: number };
  comments: number;
  createdAt: Date;
  id: string;
  viewCount: number;
}

interface MockSelectQuery {
  all: () => Promise<MockPost[]>;
  include: (
    relation: string,
    relationQuery: (relation: unknown) => unknown
  ) => MockSelectQuery;
  limit: (limit: number) => MockSelectQuery;
  orderBy: (order: (post: unknown) => unknown) => MockSelectQuery;
  where: (predicate: (post: unknown) => unknown) => MockSelectQuery;
}

interface MockUpdateQuery {
  updateAndCount: (data: { trendingScore: number }) => Promise<number>;
}

interface MockPosts {
  select: (...fields: string[]) => MockSelectQuery;
  where: (predicate: (post: unknown) => unknown) => MockUpdateQuery;
}

interface MockTransaction {
  orm: {
    public: {
      Posts: MockPosts;
    };
  };
}

const posts: MockPost[] = [
  {
    aura: 4,
    bookmarks: { total: 2 },
    comments: 1,
    createdAt: new Date("2026-09-24T10:00:00.000Z"),
    id: "post-a",
    viewCount: 20,
  },
  {
    aura: 3,
    bookmarks: { total: 1 },
    comments: 2,
    createdAt: new Date("2026-09-24T10:00:00.000Z"),
    id: "post-b",
    viewCount: 10,
  },
];
const updatedScores: number[] = [];

function createSelectQuery(rows: MockPost[]): MockSelectQuery {
  const query: MockSelectQuery = {
    all: () => Promise.resolve(rows),
    include: () => query,
    limit: () => query,
    orderBy: () => query,
    where: () => query,
  };
  return query;
}

const mockPosts: MockPosts = {
  select: () => createSelectQuery(posts),
  where: () => ({
    updateAndCount: (data) => {
      updatedScores.push(data.trendingScore);
      return Promise.resolve(1);
    },
  }),
};

const mockPrisma = {
  transaction: async <T>(
    callback: (transaction: MockTransaction) => Promise<T>
  ): Promise<T> =>
    callback({
      orm: {
        public: {
          Posts: mockPosts,
        },
      },
    }),
};

mock.module("@asm/db", () => ({
  and: (...expressions: unknown[]) => expressions,
  computeTrendingScore: (input: {
    aura: number;
    bookmarkCount: number;
    commentCount: number;
    viewCount: number;
  }): number =>
    input.aura +
    input.bookmarkCount * 2 +
    input.commentCount * 3 +
    input.viewCount / 10,
  fromPrismaDateTime: (value: Date): Date => value,
  prisma: mockPrisma,
}));

const { syncTrendingScores } = await import("./sync-trending-scores");

describe("sync-trending-scores script", () => {
  test("updates a batch transactionally using relation aggregates", async () => {
    const result = await syncTrendingScores();

    expect(result).toEqual({ batches: 1, postsUpdated: 2 });
    expect(updatedScores).toEqual([13, 12]);
  });
});
