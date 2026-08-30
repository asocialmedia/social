import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Mock the DB/session layers BEFORE importing the route: the real @asm/db
// entry validates env vars at import time, which a unit test does not have.
// The route's scorer is then imported and asserted directly so the ranking
// contract cannot silently drift from the math the route actually runs.
let lastFindUniqueArgs: unknown = null;
const mockPostFindUnique = mock((args: unknown) => {
  lastFindUniqueArgs = args;
  return Promise.resolve(null);
});

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: (posts: unknown[]) => Promise.resolve(posts),
  prisma: {
    post: {
      findMany: () => Promise.resolve([]),
      findUnique: mockPostFindUnique,
    },
  },
}));
mock.module("@/lib/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));

let cosineSimilarity: (a: number[], b: number[]) => number;
let relatedGET: (
  request: Request,
  context: { params: Promise<{ postId: string }> }
) => Promise<Response>;

beforeAll(async () => {
  ({ cosineSimilarity, GET: relatedGET } = await import("./route"));
});

describe("Related Posts semantic ranking", () => {
  beforeEach(() => {
    mockPostFindUnique.mockClear();
    lastFindUniqueArgs = null;
  });

  test("ranks higher for aligned embeddings", () => {
    const origin = [1, 0, 0, 0];
    const candidateA = [0.9, 0.1, 0, 0];
    const candidateB = [0, 0, 1, 0];

    const simA = cosineSimilarity(origin, candidateA);
    const simB = cosineSimilarity(origin, candidateB);

    expect(simA).toBeGreaterThan(simB);
    expect(simA).toBeGreaterThan(0.9);
  });

  test("handles empty or mismatched vectors safely", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test("origin query filters on moderated: false", async () => {
    // The prisma layer is mocked to return null (no matching row), so the
    // route must answer 404. The real assertion target is the where clause:
    // a moderated postId must be excluded at the query level, producing the
    // same not-found response as a nonexistent id.
    const res = await relatedGET(
      new Request("http://localhost:3000/api/posts/p-mod/related"),
      { params: Promise.resolve({ postId: "p-mod" }) }
    );
    expect(res.status).toBe(404);
    const where = (lastFindUniqueArgs as { where?: { moderated?: boolean } })
      ?.where;
    expect(where?.moderated).toBe(false);
  });
});
