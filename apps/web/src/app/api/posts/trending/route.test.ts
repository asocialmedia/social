import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

interface PostRow {
  aura: number;
  id: string;
}

const posts: PostRow[] = [
  { aura: 30, id: "p1" },
  { aura: 80, id: "p2" },
  { aura: 50, id: "p3" },
];

let lastOrderBy: unknown;
let lastTake: number;

const mockPrisma = {
  post: {
    findMany: (args: {
      cursor?: { id: string };
      orderBy?: unknown;
      take: number;
    }) => {
      lastOrderBy = args.orderBy;
      lastTake = args.take;
      const sorted = [...posts].toSorted((a, b) => b.aura - a.aura);
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
    mockGetSession.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/posts/trending"));

    expect(res.status).toBe(401);
  });

  test("orders posts by aura descending", async () => {
    const res = await GET(new Request("http://localhost/api/posts/trending"));

    expect(res.status).toBe(200);
    expect(lastOrderBy).toEqual([{ aura: "desc" }, { id: "desc" }]);

    const body = await res.json();
    expect(body.posts.map((p: PostRow) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(body.nextCursor).toBeNull();
  });

  test("returns a nextCursor when there are more posts than the page size", async () => {
    const manyPosts = Array.from({ length: 25 }, (_, i) => ({
      aura: 100 - i,
      id: `p${i}`,
    }));
    mockPrisma.post.findMany = (args: {
      cursor?: { id: string };
      orderBy?: unknown;
      take: number;
    }) => {
      lastOrderBy = args.orderBy;
      lastTake = args.take;
      return [...manyPosts].slice(0, args.take);
    };

    const res = await GET(new Request("http://localhost/api/posts/trending"));

    const body = await res.json();
    expect(body.posts).toHaveLength(20);
    expect(lastTake).toBe(21);
    expect(body.nextCursor).toBe("p20");
  });
});
