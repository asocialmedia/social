import { beforeEach, describe, expect, mock, test } from "bun:test";

const USER_ID = "user1";
const POST_ID = "post1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const mockPrisma = {
  bookmark: {
    findMany: () => [
      {
        id: "bookmark1",
        userId: USER_ID,
        postId: POST_ID,
        createdAt: new Date("2026-01-02T00:00:00Z"),
        post: { id: POST_ID },
      },
    ],
  },
  post: {
    findMany: () => [
      {
        id: POST_ID,
        userId: "author1",
        content: "hello world",
        user: { id: "author1", username: "author1" },
      },
    ],
  },
};

const mockHydrate = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  prisma: mockPrisma,
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrate,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

import { GET } from "./route";

describe("GET /api/posts/bookmarked", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  test("returns the bookmarked posts in the paginated page shape", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      nextCursor: null,
      posts: [
        {
          id: POST_ID,
          userId: "author1",
          content: "hello world",
          user: { id: "author1", username: "author1" },
        },
      ],
    });
    expect(mockHydrate).toHaveBeenCalled();
  });

  test("preserves bookmark order (most recently bookmarked first)", async () => {
    mockPrisma.bookmark.findMany = () => [
      {
        id: "bookmark2",
        userId: USER_ID,
        postId: "post2",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        post: { id: "post2" },
      },
      {
        id: "bookmark1",
        userId: USER_ID,
        postId: POST_ID,
        createdAt: new Date("2026-01-02T00:00:00Z"),
        post: { id: POST_ID },
      },
    ];
    mockPrisma.post.findMany = () => [
      {
        id: POST_ID,
        userId: "author1",
        content: "older",
        user: { id: "author1", username: "author1" },
      },
      {
        id: "post2",
        userId: "author2",
        content: "newer",
        user: { id: "author2", username: "author2" },
      },
    ];

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
      "post2",
      POST_ID,
    ]);
  });
});
