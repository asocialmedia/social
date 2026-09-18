import { beforeEach, describe, expect, mock, test } from "bun:test";

let lastFindManyArgs: {
  skip?: number;
  take?: number;
  where?: unknown;
} | null = null;

const mockPrisma = {
  post: {
    findMany: mock((args: typeof lastFindManyArgs) => {
      lastFindManyArgs = args;
      return [
        { id: "post-1", rootPostId: null },
        { id: "post-2", rootPostId: "post-1" },
      ];
    }),
  },
};

const mockHydrateViewCounts = mock((posts: unknown[]) => posts);

// Communities the viewer follows; drives whether the feed interleaves their
// posts. Empty by default (guest / no subscriptions).
let subscribedCommunityIds: string[] = [];
const mockGetSubscribedCommunityIds = mock(
  (_userId: string): Promise<string[]> =>
    Promise.resolve(subscribedCommunityIds)
);

let sessionUser: { id: string } | null = null;

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  getSubscribedCommunityIds: mockGetSubscribedCommunityIds,
  hydrateViewCounts: mockHydrateViewCounts,
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => (sessionUser ? { user: sessionUser } : null),
}));

describe("GET /api/posts/latest", () => {
  beforeEach(() => {
    lastFindManyArgs = null;
    subscribedCommunityIds = [];
    sessionUser = null;
    mockPrisma.post.findMany.mockClear();
    mockHydrateViewCounts.mockClear();
    mockGetSubscribedCommunityIds.mockClear();
  });

  test("includes responses in the latest feed", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/posts/latest?take=20")
    );

    expect(response.status).toBe(200);
    // Responses are first-class posts in the timeline, so the latest feed does
    // not exclude them. Community posts live in their own feed, so communityId
    // must be null here.
    expect(lastFindManyArgs?.where).toEqual({
      communityId: null,
      isGust: false,
    });
    expect(lastFindManyArgs?.take).toBe(21);
    expect(lastFindManyArgs?.skip).toBe(0);
  });

  test("keeps moderation filtering alongside the top-level constraint", async () => {
    const { GET } = await import("./route");

    await GET(
      new Request("http://localhost/api/posts/latest?excludeModerated=1")
    );

    expect(lastFindManyArgs?.where).toEqual({
      communityId: null,
      isGust: false,
      moderated: false,
    });
  });

  test("interleaves subscribed communities' posts into the global feed", async () => {
    sessionUser = { id: "user-1" };
    subscribedCommunityIds = ["community-a", "community-b"];

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/posts/latest"));

    // Global posts and subscribed community posts share the timeline; the
    // subscriber lookup already filters out communities the viewer cannot read.
    expect(mockGetSubscribedCommunityIds).toHaveBeenCalledWith("user-1");
    // `toEqual` is order-insensitive; the literal is key-sorted for the linter.
    expect(lastFindManyArgs?.where).toEqual({
      OR: [
        { communityId: null },
        { communityId: { in: ["community-a", "community-b"] } },
      ],
      isGust: false,
    });
  });

  test("keeps the plain global constraint when the viewer follows no community", async () => {
    sessionUser = { id: "user-1" };
    subscribedCommunityIds = [];

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/posts/latest"));

    expect(lastFindManyArgs?.where).toEqual({
      communityId: null,
      isGust: false,
    });
  });
});
