import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

interface PostRow {
  id: string;
  trendingScore: number;
}

// p2 has the most all-time aura but a low decayed score; the feed must rank
// by the worker-maintained momentum score, not raw aura.
const posts: PostRow[] = [
  { id: "p1", trendingScore: 3.5 },
  { id: "p2", trendingScore: 9.25 },
  { id: "p3", trendingScore: 6 },
];

let lastOrderBy: unknown;
let lastTake: number;
let lastWhere: unknown;

const mockPrisma = {
  post: {
    findMany: (args: {
      cursor?: { id: string };
      orderBy?: unknown;
      take: number;
      where?: unknown;
    }) => {
      lastOrderBy = args.orderBy;
      lastTake = args.take;
      lastWhere = args.where;
      const sorted = [...posts].toSorted(
        (a, b) => b.trendingScore - a.trendingScore
      );
      return sorted.slice(0, args.take);
    },
  },
};

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true, vote: true }),
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/trending", () => {
  beforeEach(() => {
    lastOrderBy = undefined;
    lastTake = 0;
    lastWhere = undefined;
    mockGetSession.mockClear();
  });

  test("allows guests to browse the trending feed", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/posts/trending"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((p: PostRow) => p.id)).toEqual(["p2", "p3", "p1"]);
  });

  test("orders posts by time-decayed trending score descending", async () => {
    const res = await GET(new Request("http://localhost/api/posts/trending"));

    expect(res.status).toBe(200);
    expect(lastOrderBy).toEqual([{ trendingScore: "desc" }, { id: "desc" }]);

    const body = await res.json();
    expect(body.posts.map((p: PostRow) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(body.nextCursor).toBeNull();
  });

  test("returns a nextCursor when there are more posts than the page size", async () => {
    const manyPosts = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      trendingScore: 100 - i,
    }));
    mockPrisma.post.findMany = (args: {
      cursor?: { id: string };
      orderBy?: unknown;
      take: number;
      where?: unknown;
    }) => {
      lastOrderBy = args.orderBy;
      lastTake = args.take;
      lastWhere = args.where;
      return [...manyPosts].slice(0, args.take);
    };

    const res = await GET(new Request("http://localhost/api/posts/trending"));

    const body = await res.json();
    expect(body.posts).toHaveLength(20);
    expect(lastTake).toBe(21);
    expect(body.nextCursor).toBe("p20");
  });

  test("includes moderated posts by default", async () => {
    await GET(new Request("http://localhost/api/posts/trending"));
    expect(lastWhere).toEqual({ isGust: false });
  });

  test("excludes moderated posts only when excludeModerated=1", async () => {
    const req = new Request(
      "http://localhost/api/posts/trending?excludeModerated=1"
    );
    await GET(req);
    expect(lastWhere).toEqual({ isGust: false, moderated: false });
  });
});
