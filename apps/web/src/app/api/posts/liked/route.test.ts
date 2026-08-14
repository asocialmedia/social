import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const votes = [{ postId: "post2" }, { postId: "post1" }];

const posts = [
  { content: "one", id: "post1", user: { id: "author1" }, viewCount: 5 },
  { content: "two", id: "post2", user: { id: "author2" }, viewCount: 10 },
];

const mockPrisma = {
  post: {
    findMany: () => [...posts],
  },
  vote: {
    findMany: () => [...votes],
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

describe("GET /api/posts/liked", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  test("returns only amplified posts in vote recency order", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
      "post2",
      "post1",
    ]);
    expect(mockHydrate).toHaveBeenCalled();
  });

  test("returns an empty list when there are no likes", async () => {
    mockPrisma.vote.findMany = () => [];

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ nextCursor: null, posts: [] });
  });
});
