import { beforeEach, describe, expect, mock, test } from "bun:test";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

interface QueryExpression {
  field: string;
  operator: string;
  value?: unknown;
}

interface QueryCall {
  limit?: number;
  where?: QueryExpression[];
}

interface MockQuery {
  all: () => Promise<unknown[]>;
  first: () => Promise<unknown>;
  include: (
    relation: string,
    query: (relationQuery: unknown) => unknown
  ) => MockQuery;
  limit: (value: number) => MockQuery;
  orderBy: (order: (model: Record<string, unknown>) => unknown) => MockQuery;
  where: (
    predicate:
      | ((model: Record<string, unknown>) => unknown)
      | Record<string, unknown>
  ) => MockQuery;
}

interface MockModel {
  select: (...fields: string[]) => MockQuery;
}

interface PoolRow {
  aura: number;
  bookmarks: { total: number };
  comments: number;
  createdAt: Date;
  embedding: number[] | null;
  id: string;
  postMedias: never[];
  postToTags: never[];
  postVisits: never[];
  semanticTags: string[] | null;
  user: { sessions: never[] };
  userId: string;
  viewCount: number;
}

let lastPoolPredicates: QueryExpression[] = [];
let poolRows: PoolRow[] = [];
let fullPostRows: Record<string, { id: string }> = {};
let notInterestedRows: { postId: string }[] = [];

function createAccessor(path: string[] = []): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return;
        }
        const field = [...path, property].join(".");
        return new Proxy<Record<string, unknown>>(
          {},
          {
            get(_fieldTarget, operator) {
              if (typeof operator !== "string") {
                return;
              }
              return (value?: unknown) => {
                let expressionValue = value;
                if (
                  (operator === "some" || operator === "none") &&
                  typeof value === "function"
                ) {
                  expressionValue = value(createAccessor([...path, property]));
                }
                return { field, operator, value: expressionValue };
              };
            },
          }
        );
      },
    }
  );
}

function flattenExpression(value: unknown): QueryExpression[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenExpression);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const expression = value as QueryExpression;
  if (expression.operator === "some" || expression.operator === "none") {
    return flattenExpression(expression.value);
  }
  return [expression];
}

function findExpression(
  expressions: QueryExpression[],
  field: string,
  operator?: string
): QueryExpression | undefined {
  return expressions.find(
    (expression) =>
      expression.field === field &&
      (operator === undefined || expression.operator === operator)
  );
}

function createMockQuery(
  all: () => unknown[],
  first: () => unknown = () => null,
  call?: QueryCall
): MockQuery {
  const query: MockQuery = {
    all: () => Promise.resolve(all()),
    first: () => Promise.resolve(first()),
    include: () => query,
    limit: (value) => {
      if (call) {
        call.limit = value;
      }
      return query;
    },
    orderBy: () => query,
    where: (predicate) => {
      if (call && typeof predicate === "function") {
        call.where = flattenExpression(predicate(createAccessor()));
      }
      return query;
    },
  };
  return query;
}

function createSelectModel(
  queryForSelect: (...fields: string[]) => MockQuery
): MockModel {
  return { select: (...fields) => queryForSelect(...fields) };
}

function createPoolRow(
  id: string,
  userId: string,
  ageInHours: number
): PoolRow {
  return {
    aura: 0,
    bookmarks: { total: 0 },
    comments: 0,
    createdAt: hoursAgo(ageInHours),
    embedding: null,
    id,
    postMedias: [],
    postToTags: [],
    postVisits: [],
    semanticTags: null,
    user: { sessions: [] },
    userId,
    viewCount: 0,
  };
}

const Posts = createSelectModel((...fields) => {
  if (fields.includes("viewCount") && fields.includes("aura")) {
    const call: QueryCall = {};
    return createMockQuery(
      () => {
        lastPoolPredicates = call.where ?? [];
        return [...poolRows];
      },
      undefined,
      call
    );
  }
  return createMockQuery(() => []);
});

const RecommendationEvents = createSelectModel(() => {
  const call: QueryCall = {};
  return createMockQuery(
    () => {
      const notInterested = findExpression(
        call.where ?? [],
        "eventType",
        "eq"
      )?.value;
      return notInterested === "NOT_INTERESTED" ? [...notInterestedRows] : [];
    },
    undefined,
    call
  );
});

const emptyModel = createSelectModel(() => createMockQuery(() => []));

const mockPrisma = {
  orm: {
    public: {
      AuraLogs: emptyModel,
      Bookmarks: emptyModel,
      CommentVotes: emptyModel,
      Comments: emptyModel,
      Follows: emptyModel,
      Posts,
      RecommendationEvents,
      Sessions: createSelectModel(() =>
        createMockQuery(
          () => [],
          () => null
        )
      ),
      Users: createSelectModel(() =>
        createMockQuery(
          () => [],
          () => null
        )
      ),
      Votes: emptyModel,
    },
  },
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

mock.module("@asm/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

mock.module("@prisma/orm-postgres/orm-client", () => ({
  and: (...expressions: unknown[]) => expressions,
}));

mock.module("../client", () => ({
  getPostDataQuery: () => createMockQuery(() => Object.values(fullPostRows)),
  mapPostData: (post: unknown) => post,
}));

mock.module("../communities/service", () => ({
  communityVisibilityWhere: () => () => ({
    field: "communityVisibility",
    operator: "eq",
    value: "visible",
  }),
}));

mock.module("../prisma", () => ({
  default: mockPrisma,
  fromPrismaDateTime: (value: unknown) =>
    value instanceof Date ? value : new Date(String(value)),
  toPrismaDateTime: (value: Date) => value,
}));

mock.module("../redis", () => ({ redis: mockRedis }));
mock.module("../../cache/search-cache", () => ({
  searchCache: {
    getHistory: mock(() => Promise.resolve([])),
  },
}));

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
    notInterestedRows = [];
    lastPoolPredicates = [];
    storedProfiles.set("fyp-profile:user-1", JSON.stringify(CACHED_PROFILE));
    fullPostRows = {};
  });

  test("anchors page 2 at the oldest pool post, not the last served one", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    poolRows = [
      createPoolRow("p-new", "fav", 2),
      createPoolRow("p-mid", "other", 5),
      createPoolRow("p-old", "other", 30),
    ];
    fullPostRows = {
      "p-mid": { id: "p-mid" },
      "p-new": { id: "p-new" },
    };

    const page = await getPersonalizedFeedPage({
      pageSize: 2,
      userId: "user-1",
    });

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
    expect(
      findExpression(lastPoolPredicates, "createdAt", "lte")?.value
    ).toBeInstanceOf(Date);
    expect(findExpression(lastPoolPredicates, "isGust", "eq")?.value).toBe(
      false
    );
    expect(findExpression(lastPoolPredicates, "userId", "neq")?.value).toBe(
      "user-1"
    );
    expect(findExpression(lastPoolPredicates, "moderated", "eq")?.value).toBe(
      false
    );
    expect(
      findExpression(lastPoolPredicates, "postVisits.userId", "eq")?.value
    ).toBe("user-1");
  });

  test("includes moderated posts unless the caller opts out", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({ pageSize: 20, userId: "user-1" });
    expect(
      findExpression(lastPoolPredicates, "moderated", "eq")
    ).toBeUndefined();
  });

  test("can build a personalized Gusts pool without mixing in fleets", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({
      contentKind: "gust",
      pageSize: 20,
      userId: "user-1",
    });
    expect(findExpression(lastPoolPredicates, "isGust", "eq")?.value).toBe(
      true
    );
  });

  test("serves cached profiles without rebuilding engagement history", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({ pageSize: 20, userId: "user-1" });
    expect(mockRedis.get).toHaveBeenCalledWith("fyp-profile:user-1");
  });

  test("hard-excludes dismissed posts from the candidate pool", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    notInterestedRows = [{ postId: "p-dismissed" }, { postId: "p-also" }];

    await getPersonalizedFeedPage({ pageSize: 20, userId: "user-1" });

    expect(findExpression(lastPoolPredicates, "id", "notIn")?.value).toEqual([
      "p-dismissed",
      "p-also",
    ]);
  });

  test("omits the exclusion clause when nothing is dismissed", async () => {
    const { getPersonalizedFeedPage } = await import("./feed-service");
    await getPersonalizedFeedPage({ pageSize: 20, userId: "user-1" });
    expect(findExpression(lastPoolPredicates, "id", "notIn")).toBeUndefined();
  });
});

describe("buildAndCacheProfile search history", () => {
  test("handles query, user, and post history entries without crashing on missing post content", async () => {
    const { buildAndCacheProfile } = await import("./feed-service");
    const historyMock = mock(() =>
      Promise.resolve([
        {
          query: "hello #rust world",
          raw: '{"type":"query","query":"hello #rust world"}',
          searchedAt: Date.now(),
          type: "query" as const,
        },
        {
          raw: '{"type":"user"}',
          searchedAt: Date.now(),
          type: "user" as const,
          user: {
            aura: 0,
            avatarUrl: null,
            badge: null,
            badges: [],
            bio: null,
            displayName: "Alice",
            displayUsername: null,
            id: "user-alice",
            username: "alice",
          },
        },
        {
          post: {
            aura: 0,
            authorAvatarUrl: null,
            authorBadge: null,
            authorBadges: [],
            authorDisplayName: "Bob",
            authorId: "author-bob",
            authorUsername: "bob",
            createdAt: new Date(),
            explicitContent: false,
            id: "post-123",
            previewMedia: null,
            viewCount: 0,
          } as unknown as { content: string },
          raw: '{"type":"post"}',
          searchedAt: Date.now(),
          type: "post" as const,
        },
      ])
    );
    const searchCacheModule = await import("../../cache/search-cache");
    const previous = searchCacheModule.searchCache.getHistory;
    searchCacheModule.searchCache.getHistory =
      historyMock as unknown as typeof previous;
    storedProfiles.clear();

    const profile = await buildAndCacheProfile("user-history");

    expect(profile.tagWeights.hello).toBeGreaterThan(0);
    expect(
      profile.authorWeights["user-alice"] ?? profile.tagWeights["user-alice"]
    ).toBeDefined();
    expect(profile.authorWeights["author-bob"] ?? 0).toBeGreaterThanOrEqual(0);
    searchCacheModule.searchCache.getHistory = previous;
  });
});

describe("getNotInterestedPostIds", () => {
  beforeEach(() => {
    notInterestedRows = [];
  });

  test("dedupes repeated dismissals of the same post", async () => {
    const { getNotInterestedPostIds } = await import("./feed-service");
    notInterestedRows = [
      { postId: "p-1" },
      { postId: "p-1" },
      { postId: "p-2" },
    ];
    expect(await getNotInterestedPostIds("user-1")).toEqual(["p-1", "p-2"]);
  });

  test("returns nothing for a guest", async () => {
    const { getNotInterestedPostIds } = await import("./feed-service");
    notInterestedRows = [{ postId: "p-1" }];
    expect(await getNotInterestedPostIds("")).toEqual([]);
  });

  test("returns nothing when the viewer has no dismissals", async () => {
    const { getNotInterestedPostIds } = await import("./feed-service");
    expect(await getNotInterestedPostIds("user-1")).toEqual([]);
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
