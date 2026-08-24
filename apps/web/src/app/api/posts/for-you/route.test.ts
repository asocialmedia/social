import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

interface PostRow {
  id: string;
}

let lastFindManyArgs: {
  cursor?: { id: string };
  orderBy?: unknown;
  take?: number;
  where?: unknown;
} | null = null;

const chronologicalPosts = [
  { createdAt: new Date("2026-08-20T00:00:00Z"), id: "chrono-2" },
  { createdAt: new Date("2026-08-19T00:00:00Z"), id: "chrono-1" },
];

const mockPrisma = {
  post: {
    findMany: mock(
      (args?: {
        cursor?: { id: string };
        orderBy?: unknown;
        take?: number;
        where?: unknown;
      }) => {
        lastFindManyArgs = args ?? null;
        return chronologicalPosts.slice(0, args?.take ?? 20);
      }
    ),
  },
};

const lastPersonalizedArgs: {
  excludeModerated?: boolean;
  pageSize?: number;
  userId?: string;
}[] = [];

// Ranked page whose anchor cursor hands pagination back to recency.
const personalizedPage = {
  anchorCursor: "rec-3",
  posts: [{ id: "rec-3" }, { id: "rec-1" }, { id: "rec-2" }],
};

const mockGetPersonalizedFeedPage = mock(
  (args: { excludeModerated: boolean; pageSize: number; userId: string }) => {
    lastPersonalizedArgs.push(args);
    return personalizedPage;
  }
);

const mockHydrate = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  getPersonalizedFeedPage: mockGetPersonalizedFeedPage,
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/for-you", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: USER_ID } }));
    mockPrisma.post.findMany.mockClear();
    mockGetPersonalizedFeedPage.mockClear();
    mockHydrate.mockClear();
    lastFindManyArgs = null;
    lastPersonalizedArgs.length = 0;
  });

  test("ranks the first page for signed-in users without touching recency", async () => {
    const res = await GET(new Request("http://localhost/api/posts/for-you"));

    expect(res.status).toBe(200);
    expect(mockGetPersonalizedFeedPage).toHaveBeenCalledTimes(1);
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();

    const body = await res.json();
    // Rank order must be preserved exactly as the service returned it.
    expect(body.posts.map((p: PostRow) => p.id)).toEqual([
      "rec-3",
      "rec-1",
      "rec-2",
    ]);
    expect(body.nextCursor).toBe("rec-3");
  });

  test("serves guests plain recency without personalizing", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/posts/for-you"));

    expect(res.status).toBe(200);
    expect(mockGetPersonalizedFeedPage).not.toHaveBeenCalled();
    expect(lastFindManyArgs?.orderBy).toEqual({ createdAt: "desc" });

    const body = await res.json();
    expect(body.posts.map((p: PostRow) => p.id)).toEqual([
      "chrono-2",
      "chrono-1",
    ]);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=10, stale-while-revalidate=30"
    );
  });

  test("cursor pages fall back to strict recency anchored after the cursor", async () => {
    const res = await GET(
      new Request("http://localhost/api/posts/for-you?cursor=some-post")
    );

    expect(res.status).toBe(200);
    expect(mockGetPersonalizedFeedPage).not.toHaveBeenCalled();
    expect(lastFindManyArgs?.cursor).toEqual({ id: "some-post" });

    const body = await res.json();
    // Both fixtures fit under the page size, so the feed ends here.
    expect(body.nextCursor).toBeNull();
  });

  test("recovers instead of 500ing when the cursor post was deleted", async () => {
    // First attempt hits Prisma's P2025 (cursor row gone); the retry runs
    // cursor-less and serves the top of the feed.
    mockPrisma.post.findMany.mockImplementationOnce(() => {
      throw Object.assign(new Error("Record not found"), { code: "P2025" });
    });

    const res = await GET(
      new Request("http://localhost/api/posts/for-you?cursor=deleted-post")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((p: PostRow) => p.id)).toEqual([
      "chrono-2",
      "chrono-1",
    ]);
    expect(body.nextCursor).toBeNull();
  });

  test("still surfaces unexpected database errors", async () => {
    mockPrisma.post.findMany.mockImplementationOnce(() => {
      throw new Error("connection refused");
    });
    await expect(
      GET(new Request("http://localhost/api/posts/for-you?cursor=whatever"))
    ).rejects.toThrow("connection refused");
  });

  test("falls back to recency when the personalized pool is empty", async () => {
    mockGetPersonalizedFeedPage.mockResolvedValueOnce({
      anchorCursor: null,
      posts: [],
    });

    const res = await GET(new Request("http://localhost/api/posts/for-you"));

    expect(mockGetPersonalizedFeedPage).toHaveBeenCalledTimes(1);
    expect(lastFindManyArgs?.orderBy).toEqual({ createdAt: "desc" });
    const body = await res.json();
    expect(body.posts.map((p: PostRow) => p.id)).toEqual([
      "chrono-2",
      "chrono-1",
    ]);
  });

  test("passes excludeModerated through to personalization and recency", async () => {
    await GET(
      new Request("http://localhost/api/posts/for-you?excludeModerated=1")
    );
    expect(lastPersonalizedArgs[0]?.excludeModerated).toBe(true);

    mockGetSession.mockResolvedValueOnce(null);
    await GET(
      new Request("http://localhost/api/posts/for-you?excludeModerated=1")
    );
    expect(lastFindManyArgs?.where).toEqual({
      isGust: false,
      moderated: false,
    });
  });

  test("caps take at 20 and forwards it to the personalized page", async () => {
    const res = await GET(
      new Request("http://localhost/api/posts/for-you?take=99")
    );

    expect(lastPersonalizedArgs[0]?.pageSize).toBe(20);
    const body = await res.json();
    expect(body.posts.length).toBeLessThanOrEqual(20);

    // Malformed take values fall back to the default page size.
    await GET(new Request("http://localhost/api/posts/for-you?take=-3x"));
    expect(lastPersonalizedArgs[1]?.pageSize).toBe(20);
  });

  test("signed-in responses stay private and uncacheable", async () => {
    const res = await GET(new Request("http://localhost/api/posts/for-you"));
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
  });
});
