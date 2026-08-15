import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "user1";
const POST_ID = "post1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

let lastPostFindManyArgs: { where?: { isGust?: boolean } } | null = null;

const mockPrisma = {
  bookmark: {
    findMany: () => [
      {
        createdAt: new Date("2026-01-02T00:00:00Z"),
        id: "bookmark1",
        post: { id: POST_ID },
        postId: POST_ID,
        userId: USER_ID,
      },
    ],
  },
  post: {
    findMany: (args: { where?: { isGust?: boolean } }) => {
      lastPostFindManyArgs = args;
      return [
        {
          content: "hello world",
          id: POST_ID,
          user: { id: "author1", username: "author1" },
          userId: "author1",
        },
      ];
    },
  },
};

const mockHydrate = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/bookmarked", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
    lastPostFindManyArgs = null;
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/posts/bookmarked"));

    expect(res.status).toBe(401);
  });

  test("returns the bookmarked posts in the paginated page shape", async () => {
    const res = await GET(new Request("http://localhost/api/posts/bookmarked"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      nextCursor: null,
      posts: [
        {
          content: "hello world",
          id: POST_ID,
          user: { id: "author1", username: "author1" },
          userId: "author1",
        },
      ],
    });
    expect(mockHydrate).toHaveBeenCalled();
  });

  test("defaults the posts tab to regular (non-gust) posts", async () => {
    await GET(new Request("http://localhost/api/posts/bookmarked"));

    expect(lastPostFindManyArgs?.where?.isGust).toBe(false);
  });

  test("filters to gusts when filter=gusts", async () => {
    const res = await GET(
      new Request("http://localhost/api/posts/bookmarked?filter=gusts")
    );

    expect(res.status).toBe(200);
    expect(lastPostFindManyArgs?.where?.isGust).toBe(true);
  });

  test("preserves bookmark order (most recently bookmarked first)", async () => {
    mockPrisma.bookmark.findMany = () => [
      {
        createdAt: new Date("2026-01-03T00:00:00Z"),
        id: "bookmark2",
        post: { id: "post2" },
        postId: "post2",
        userId: USER_ID,
      },
      {
        createdAt: new Date("2026-01-02T00:00:00Z"),
        id: "bookmark1",
        post: { id: POST_ID },
        postId: POST_ID,
        userId: USER_ID,
      },
    ];
    mockPrisma.post.findMany = () => [
      {
        content: "older",
        id: POST_ID,
        user: { id: "author1", username: "author1" },
        userId: "author1",
      },
      {
        content: "newer",
        id: "post2",
        user: { id: "author2", username: "author2" },
        userId: "author2",
      },
    ];

    const res = await GET(new Request("http://localhost/api/posts/bookmarked"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
      "post2",
      POST_ID,
    ]);
  });
});
