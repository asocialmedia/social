import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

interface PostRow {
  content: string;
  createdAt: Date;
  id: string;
  moderated?: boolean;
}

let mockSessionUser: { id: string } | null = { id: "user-123" };
let mockPersonalizedPage: {
  anchorCursor: string | null;
  nextCursor?: string | null;
  posts: PostRow[];
} = {
  anchorCursor: "p-anchor",
  nextCursor: "fyp.20.1700000000",
  posts: [],
};

let lastLegacyArgs: {
  cursor?: { id: string };
  orderBy?: unknown;
  skip?: number;
  take?: number;
  where?: unknown;
} | null = null;
let pgPosts: PostRow[] = [];

const mockFindPosts = mock(
  (args?: {
    cursor?: { id: string };
    skip?: number;
    take?: number;
    where?: unknown;
  }) => {
    lastLegacyArgs = args ?? null;
    return [...pgPosts].slice(0, args?.take ?? 21);
  }
);

const mockHydrate = mock((posts: unknown[]) => posts);
const mockGetPersonalizedFeedPage = mock(
  (_args: unknown) => mockPersonalizedPage
);

interface PostQuery {
  all: () => ReturnType<typeof mockFindPosts>;
  cursor: (cursor: { id: string }) => PostQuery;
  limit: (limit: number) => PostQuery;
  offset: (offset: number) => PostQuery;
  orderBy: (order: unknown) => PostQuery;
  where: (
    predicate: (post: {
      isGust: { eq: (value: boolean) => unknown };
      moderated: { eq: (value: boolean) => unknown };
      userId: { neq: (id: string) => unknown };
    }) => unknown
  ) => PostQuery;
}

function createPostQuery(): PostQuery {
  const state = {
    cursorId: undefined as string | undefined,
    limit: 21,
    offset: 0,
    where: {} as Record<string, unknown>,
  };
  const query: PostQuery = {
    all: () =>
      mockFindPosts({
        cursor: state.cursorId ? { id: state.cursorId } : undefined,
        skip: state.offset,
        take: state.limit,
        where: state.where,
      }),
    cursor: (cursor) => {
      state.cursorId = cursor.id;
      return query;
    },
    limit: (limit) => {
      state.limit = limit;
      return query;
    },
    offset: (offset) => {
      state.offset = offset;
      return query;
    },
    orderBy: () => query,
    where: (predicate) => {
      const where: Record<string, unknown> = {};
      predicate({
        isGust: { eq: (value) => (where.isGust = value) },
        moderated: { eq: (value) => (where.moderated = value) },
        userId: { neq: (id) => (where.userId = { not: id }) },
      });
      state.where = where;
      return query;
    },
  };
  return query;
}

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  communityVisibilityWhere: () => () => ({}),
  getPersonalizedFeedPage: mockGetPersonalizedFeedPage,
  getPostDataQuery: () => createPostQuery(),
  hydrateViewCounts: mockHydrate,
  prisma: {},
}));

mock.module("@asm/db/recommendation/trending-snapshot", () => ({
  encodeTrendingCursor: () => "tz1.mock",
  fetchTrendingSnapshotPage: () => null,
  isTrendingSnapshotCursor: (raw: string | undefined | null) =>
    Boolean(raw && raw.startsWith("tz1.")),
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => (mockSessionUser ? { user: mockSessionUser } : null),
}));

describe("GET /api/posts/for-you", () => {
  beforeEach(() => {
    mockSessionUser = { id: "user-123" };
    mockPersonalizedPage = {
      anchorCursor: "p-anchor",
      nextCursor: "fyp.20.1700000000",
      posts: [],
    };
    pgPosts = [];
    lastLegacyArgs = null;
    mockGetPersonalizedFeedPage.mockClear();
    mockFindPosts.mockClear();
  });

  test("serves personalized feed for signed-in user without cursor", async () => {
    const { GET } = await import("./route");
    mockPersonalizedPage = {
      anchorCursor: "p-anchor",
      nextCursor: "fyp.20.1700000000",
      posts: [{ content: "hi", createdAt: new Date(), id: "p1" }],
    };

    const res = await GET(new Request("http://localhost/api/posts/for-you"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].id).toBe("p1");
    expect(body.nextCursor).toBe("fyp.20.1700000000");
    expect(mockGetPersonalizedFeedPage).toHaveBeenCalledTimes(1);
  });

  test("continues personalization with fyp. cursor", async () => {
    const { GET } = await import("./route");
    mockPersonalizedPage = {
      anchorCursor: "p-anchor",
      nextCursor: "exp.p-anchor",
      posts: [{ content: "hi page 2", createdAt: new Date(), id: "p21" }],
    };

    const res = await GET(
      new Request("http://localhost/api/posts/for-you?cursor=fyp.20.1700000000")
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].id).toBe("p21");
    expect(body.nextCursor).toBeNull();
  });

  test("fills a short ranked page from the chronological archive", async () => {
    const { GET } = await import("./route");
    mockPersonalizedPage = {
      anchorCursor: "p-anchor",
      nextCursor: "exp.p-anchor",
      posts: [{ content: "ranked", createdAt: new Date(), id: "ranked-1" }],
    };
    pgPosts = [
      { content: "archive 1", createdAt: new Date(), id: "archive-1" },
      { content: "archive 2", createdAt: new Date(), id: "archive-2" },
    ];

    const res = await GET(new Request("http://localhost/api/posts/for-you"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((post: PostRow) => post.id)).toEqual([
      "ranked-1",
      "archive-1",
      "archive-2",
    ]);
    expect(body.nextCursor).toBeNull();
  });

  test("falls back to chronological expired posts at bottom with exp. cursor", async () => {
    const { GET } = await import("./route");
    pgPosts = [
      { content: "expired 1", createdAt: new Date(), id: "exp-1" },
      { content: "expired 2", createdAt: new Date(), id: "exp-2" },
    ];

    const res = await GET(
      new Request("http://localhost/api/posts/for-you?cursor=exp.p-anchor")
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0].id).toBe("exp-1");
    expect(lastLegacyArgs?.cursor).toEqual({ id: "p-anchor" });
    expect(lastLegacyArgs?.skip).toBe(1);
  });

  test("allows guests to browse chronological recency", async () => {
    const { GET } = await import("./route");
    mockSessionUser = null;
    pgPosts = [{ content: "guest post", createdAt: new Date(), id: "g1" }];

    const res = await GET(new Request("http://localhost/api/posts/for-you"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.posts).toHaveLength(1);
    expect(mockGetPersonalizedFeedPage).not.toHaveBeenCalled();
    expect(lastLegacyArgs?.where).toEqual({
      isGust: false,
    });
  });

  test("excludes the signed-in user's own posts from the chronological fallback", async () => {
    const { GET } = await import("./route");
    mockPersonalizedPage = {
      anchorCursor: "p-anchor",
      nextCursor: "fyp.20.1700000000",
      posts: [],
    };

    await GET(new Request("http://localhost/api/posts/for-you"));

    expect(lastLegacyArgs?.where).toEqual({
      isGust: false,
      moderated: undefined,
      userId: { not: "user-123" },
    });
  });
});
