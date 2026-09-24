import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

const USER_ID = "user1";
const POST_ID = "post1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

let lastPostFindManyArgs: { where?: { isGust?: boolean } } | null = null;
let bookmarkRows = [
  {
    createdAt: new Date("2026-01-02T00:00:00Z"),
    id: "bookmark1",
    postId: POST_ID,
    userId: USER_ID,
  },
];
let postRows = [
  {
    content: "hello world",
    id: POST_ID,
    user: { id: "author1", username: "author1" },
    userId: "author1",
  },
];

interface BookmarkQuery {
  all: () => Promise<typeof bookmarkRows>;
  orderBy: () => BookmarkQuery;
  where: (where: { userId: string }) => BookmarkQuery;
}

function createBookmarkQuery(): BookmarkQuery {
  return {
    all: () => Promise.resolve([...bookmarkRows]),
    orderBy: () => createBookmarkQuery(),
    where: () => createBookmarkQuery(),
  };
}

const mockPrisma = {
  orm: {
    public: {
      Bookmarks: { select: () => createBookmarkQuery() },
    },
  },
};

const mockHydrate = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getPostDataQuery: () => ({
    where: (
      predicate: (post: {
        id: { in: (ids: string[]) => unknown };
        isGust: { eq: (value: boolean) => unknown };
      }) => unknown
    ) => {
      let isGust = false;
      predicate({
        id: { in: () => ({}) },
        isGust: { eq: (value) => (isGust = value) },
      });
      lastPostFindManyArgs = { where: { isGust } };
      return {
        all: () =>
          postRows.filter((post) =>
            "isGust" in post ? post.isGust === isGust : true
          ),
      };
    },
  }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/bookmarked", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
    lastPostFindManyArgs = null;
    bookmarkRows = [
      {
        createdAt: new Date("2026-01-02T00:00:00Z"),
        id: "bookmark1",
        postId: POST_ID,
        userId: USER_ID,
      },
    ];
    postRows = [
      {
        content: "hello world",
        id: POST_ID,
        user: { id: "author1", username: "author1" },
        userId: "author1",
      },
    ];
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
    bookmarkRows = [
      {
        createdAt: new Date("2026-01-03T00:00:00Z"),
        id: "bookmark2",
        postId: "post2",
        userId: USER_ID,
      },
      {
        createdAt: new Date("2026-01-02T00:00:00Z"),
        id: "bookmark1",
        postId: POST_ID,
        userId: USER_ID,
      },
    ];
    postRows = [
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
