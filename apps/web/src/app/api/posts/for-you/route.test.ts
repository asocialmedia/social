import { beforeEach, describe, expect, mock, test } from "bun:test";

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

const mockPrisma = {
  post: {
    findMany: mock(
      (args?: {
        cursor?: { id: string };
        include?: unknown;
        orderBy?: unknown;
        skip?: number;
        take?: number;
        where?: unknown;
      }) => {
        lastLegacyArgs = args ?? null;
        return [...pgPosts].slice(0, args?.take ?? 21);
      }
    ),
  },
};

const mockHydrate = mock((posts: unknown[]) => posts);
const mockGetPersonalizedFeedPage = mock(
  (_args: unknown) => mockPersonalizedPage
);

mock.module("@asm/db", () => ({
  encodeTrendingCursor: () => "tz1.mock",
  fetchTrendingSnapshotPage: () => null,
  getPersonalizedFeedPage: mockGetPersonalizedFeedPage,
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrate,
  isTrendingSnapshotCursor: (raw: string | undefined | null) =>
    Boolean(raw && raw.startsWith("tz1.")),
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
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
    mockPrisma.post.findMany.mockClear();
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
    expect(body.nextCursor).toBe("exp.p-anchor");
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
    expect(lastLegacyArgs?.where).toEqual({ isGust: false });
  });
});
