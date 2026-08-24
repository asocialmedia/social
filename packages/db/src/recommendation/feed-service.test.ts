import { beforeEach, describe, expect, mock, test } from "bun:test";

// Feed-service tests mock its two IO dependencies by their relative module
// paths (the service lives one directory below src/, same as these mocks'
// resolution root) and keep every scoring module real, so rankings below are
// produced by the actual production math.

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

interface FindManyArgs {
  include?: unknown;
  orderBy?: unknown;
  select?: unknown;
  take?: number;
  where?: unknown;
}

let lastPoolArgs: FindManyArgs | null = null;
let _lastFullPostArgs: FindManyArgs | null = null;

// Pool rows in the order the DB returns them: createdAt desc.
let poolRows: {
  _count: { bookmarks: number; comments: number };
  aura: number;
  createdAt: Date;
  id: string;
  tags: { name: string }[];
  userId: string;
  viewCount: number;
}[] = [];

let fullPostRows: Record<string, { id: string }> = {};

const mockPrisma = {
  bookmark: { findMany: mock(() => []) },
  comment: { findMany: mock(() => []) },
  commentVote: { findMany: mock(() => []) },
  follow: { findMany: mock(() => []) },
  post: {
    findMany: mock((args?: FindManyArgs) => {
      if (args?.include) {
        _lastFullPostArgs = args;
        // Serve whichever ids the caller asks for, in map-retrievable form.
        const ids =
          typeof args.where === "object" &&
          args.where !== null &&
          "id" in args.where
            ? (args.where as { id: { in: string[] } }).id.in
            : [];
        return ids.map((id) => fullPostRows[id]).filter(Boolean);
      }
      lastPoolArgs = args ?? null;
      return [...poolRows];
    }),
  },
  vote: { findMany: mock(() => []) },
};

const deletedKeys: string[] = [];
const storedProfiles = new Map<string, string>();

const mockRedis = {
  del: mock((key: string) => {
    deletedKeys.push(key);
    storedProfiles.delete(key);
    return 1;
  }),
  get: mock((key: string) => storedProfiles.get(key) ?? null),
  set: mock((key: string, value: string) => {
    storedProfiles.set(key, value);
    return "OK";
  }),
};

mock.module("../prisma", () => ({ default: mockPrisma }));
mock.module("../redis", () => ({ redis: mockRedis }));

const CACHED_PROFILE = {
  authorWeights: { fav: 1 },
  followedAuthorIds: [],
  tagWeights: {},
};

describe("getPersonalizedFeedPage", () => {
  beforeEach(() => {
    deletedKeys.length = 0;
    storedProfiles.clear();
    poolRows = [];
    lastPoolArgs = null;
    mockPrisma.comment.findMany.mockClear();
    mockPrisma.vote.findMany.mockClear();
    storedProfiles.set("fyp-profile:user-1", JSON.stringify(CACHED_PROFILE));
    // Reset the include-fetch fixture so rows staged by one test cannot
    // leak into later tests.
    fullPostRows = {};
  });

  test("anchors page 2 at the oldest pool post, not the last served one", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    poolRows = [
      {
        _count: { bookmarks: 0, comments: 0 },
        aura: 0,
        createdAt: hoursAgo(2),
        id: "p-new",
        tags: [],
        userId: "fav",
        viewCount: 0,
      },
      {
        _count: { bookmarks: 0, comments: 0 },
        aura: 0,
        createdAt: hoursAgo(5),
        id: "p-mid",
        tags: [],
        userId: "other",
        viewCount: 0,
      },
      {
        _count: { bookmarks: 0, comments: 0 },
        aura: 0,
        createdAt: hoursAgo(30),
        id: "p-old",
        tags: [],
        userId: "other",
        viewCount: 0,
      },
    ];
    fullPostRows["p-new"] = { id: "p-new" };
    fullPostRows["p-mid"] = { id: "p-mid" };

    const page = await getPersonalizedFeedPage({
      pageSize: 2,
      userId: "user-1",
    });

    // Ranking favors the profile's author, so the served pair is p-new and
    // p-mid while low-score p-old goes unserved - yet the cursor must still
    // point AT p-old so recency resumes exactly where the pool ended.
    expect(page.posts.map((post) => post.id)).toEqual(["p-new", "p-mid"]);
    expect(page.anchorCursor).toBe("p-old");
  });

  test("returns an empty page with no anchor when the pool is empty", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    const page = await getPersonalizedFeedPage({
      pageSize: 20,
      userId: "user-1",
    });
    expect(page.posts).toEqual([]);
    expect(page.anchorCursor).toBeNull();
  });

  test("scopes the pool to non-gust unvisited posts and passes moderation opt-out", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({
      excludeModerated: true,
      pageSize: 20,
      userId: "user-1",
    });
    expect(lastPoolArgs?.where).toMatchObject({
      createdAt: { gte: expect.any(Date) },
      isGust: false,
      moderated: false,
      visits: { none: { userId: "user-1" } },
    });
  });

  test("includes moderated posts unless the caller opts out", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({ pageSize: 20, userId: "user-1" });
    // The filter is only attached when the caller opts out.
    expect(
      (lastPoolArgs?.where as { moderated?: boolean } | null)?.moderated
    ).toBeUndefined();
  });

  test("serves stale-taste-free cached profiles without rebuilding", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({ pageSize: 20, userId: "user-1" });
    // Cache hit: no engagement-history queries fire.
    expect(mockPrisma.vote.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.comment.findMany).not.toHaveBeenCalled();
  });
});

describe("invalidateFypProfile", () => {
  beforeEach(() => {
    deletedKeys.length = 0;
  });

  test("deletes the user's profile key under the shared prefix", async () => {
    const { invalidateFypProfile } = await import("./feed-service");
    await invalidateFypProfile("user-42");
    expect(deletedKeys).toEqual(["fyp-profile:user-42"]);
  });

  test("swallows Redis failures so callers can fire-and-forget", async () => {
    const { invalidateFypProfile } = await import("./feed-service");
    mockRedis.del.mockImplementationOnce(() => {
      throw new Error("redis down");
    });
    await expect(invalidateFypProfile("user-1")).resolves.toBeUndefined();
  });
});
