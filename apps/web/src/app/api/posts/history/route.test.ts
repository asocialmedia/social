import { beforeEach, describe, expect, mock, test } from "bun:test";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const visits = [{ postId: "post2" }, { postId: "post1" }, { postId: "post3" }];

const posts = [
  { id: "post1", content: "one", user: { id: "author1" } },
  { id: "post2", content: "two", user: { id: "author2" } },
  { id: "post3", content: "three", user: { id: "author3" } },
];

let lastTake: number;

const mockPrisma = {
  postVisit: {
    findMany: (args: {
      orderBy: unknown;
      select: { postId: boolean };
      take: number;
      where: { userId: string };
    }) => {
      lastTake = args.take;
      return [...visits];
    },
  },
  post: {
    findMany: () => [...posts],
  },
};

const mockHydrate = mock((items: unknown[]) => items);

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

import { GET } from "./route";

describe("GET /api/posts/history", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  test("limits to 12 most recent visited posts", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(lastTake).toBe(12);
    const body = await res.json();
    // Order follows visit recency (post2 visited most recently).
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
      "post2",
      "post1",
      "post3",
    ]);
  });

  test("returns an empty list when there is no history", async () => {
    mockPrisma.postVisit.findMany = () => [];

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ posts: [] });
  });
});
