import { beforeEach, describe, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "user1" },
}));
let networkPreferences = defaultNetworkPreferences();

const mockNetworkFeed = mock(
  (_request: Request, _userId: string, _mode: string, _contentKind: string) =>
    Response.json({ nextCursor: null, posts: [] })
);
mock.module("@/lib/recommendations/network-native-feed", () => ({
  networkNativeFeed: mockNetworkFeed,
}));

const mockFollowingGustsPage = mock(() =>
  Promise.resolve({ nextCursor: null, posts: [] })
);
mock.module("@/lib/gusts/following", () => ({
  followingGustsPage: mockFollowingGustsPage,
}));

const sampleGusts = [
  {
    attachments: [{ id: "m1", type: "VIDEO" }],
    aura: 10,
    content: "A landscape clip",
    createdAt: new Date("2026-01-01T10:00:00Z"),
    explicitContent: false,
    id: "gust1",
    isGust: true,
    user: { id: "u1", username: "alice" },
  },
  {
    attachments: [{ id: "m2", type: "VIDEO" }],
    aura: 25,
    content: "A landscape clip",
    createdAt: new Date("2026-01-01T09:00:00Z"),
    explicitContent: false,
    id: "gust2",
    isGust: true,
    user: { id: "u2", username: "bob" },
  },
];

let mockPostList = [...sampleGusts];
let lastFindManyArgs: unknown = null;

const mockFindMany = mock(
  (args: {
    cursor?: { id: string };
    take?: number;
    where?: { id?: { not?: string }; isGust?: boolean; rootPostId?: null };
  }) => {
    lastFindManyArgs = args;
    const take = args?.take ?? 11;
    let list = mockPostList;
    if (args?.where?.id?.not) {
      list = list.filter((post) => post.id !== args.where?.id?.not);
    }
    if (args?.where?.isGust) {
      list = list.filter((post) => post.isGust);
    }
    if (args?.cursor?.id) {
      const cursorIndex = list.findIndex((post) => post.id === args.cursor?.id);
      if (cursorIndex !== -1) {
        list = list.slice(cursorIndex + 1);
      }
    }
    return list.slice(0, take);
  }
);

const mockHydrateViewCounts = mock((posts: unknown[]) =>
  posts.map((p) => ({ ...(p as Record<string, unknown>), viewCount: 42 }))
);

const mockFindUnique = mock(
  (args: {
    where?: { id?: string; isGust?: boolean; moderated?: boolean };
  }) => {
    const candidate = mockPostList.find((g) => g.id === args?.where?.id);
    if (!candidate) {
      return null;
    }
    if (
      args?.where?.moderated === false &&
      (candidate as { moderated?: boolean }).moderated
    ) {
      return null;
    }
    return candidate;
  }
);

interface PostQuery {
  all: () => ReturnType<typeof mockFindMany>;
  cursor: (cursor: { createdAt: Date; id: string }) => PostQuery;
  first: () => ReturnType<typeof mockFindUnique>;
  limit: (limit: number) => PostQuery;
  offset: (offset: number) => PostQuery;
  orderBy: (order: unknown) => PostQuery;
  where: (
    predicate: (post: {
      id: {
        desc: () => unknown;
        eq: (id: string) => unknown;
        neq: (id: string) => unknown;
      };
      isGust: { eq: (value: boolean) => unknown };
      moderated: { eq: (value: boolean) => unknown };
      explicitContent: { eq: (value: boolean) => unknown };
      postMedias: {
        some: (
          predicate: (media: {
            _type: { eq: (value: string) => unknown };
          }) => unknown
        ) => unknown;
      };
      rootPostId: { isNull: () => unknown };
    }) => unknown
  ) => PostQuery;
}

function createPostQuery(): PostQuery {
  const state = {
    cursorId: undefined as string | undefined,
    excludeId: undefined as string | undefined,
    excludeModerated: false,
    id: undefined as string | undefined,
    isGust: true,
    limit: 11,
    offset: 0,
  };
  const query: PostQuery = {
    all: () => {
      const args = {
        cursor: state.cursorId ? { id: state.cursorId } : undefined,
        take: state.limit,
        where: {
          id: state.excludeId ? { not: state.excludeId } : undefined,
          isGust: state.isGust,
          rootPostId: null,
        },
      };
      return mockFindMany(args);
    },
    cursor: (cursor) => {
      state.cursorId = cursor.id;
      return query;
    },
    first: () =>
      mockFindUnique({
        where: {
          id: state.id,
          moderated: state.excludeModerated ? false : undefined,
        },
      }),
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
      predicate({
        explicitContent: { eq: () => ({}) },
        id: {
          desc: () => ({}),
          eq: (id) => (state.id = id),
          neq: (id) => (state.excludeId = id),
        },
        isGust: { eq: (value) => (state.isGust = value) },
        moderated: {
          eq: (value) => {
            state.excludeModerated = value === false;
            return {};
          },
        },
        postMedias: { some: () => ({}) },
        rootPostId: { isNull: () => ({}) },
      });
      return query;
    },
  };
  return query;
}

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  MediaType: {
    AUDIO: "AUDIO",
    IMAGE: "IMAGE",
    VIDEO: "VIDEO",
  },
  getPostDataQuery: () => createPostQuery(),
  hydrateViewCounts: mockHydrateViewCounts,
  prisma: {
    orm: {
      public: {
        Posts: {
          select: () => ({
            where: (where: { id: string }) => ({
              first: () => mockFindUnique({ where }),
            }),
          }),
        },
      },
    },
  },
  readNetworkPreferences: () =>
    Promise.resolve({ preferences: networkPreferences, revision: 0 }),
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/gusts", () => {
  beforeEach(() => {
    networkPreferences = defaultNetworkPreferences();
    mockNetworkFeed.mockClear();
    mockPostList = [...sampleGusts];
    lastFindManyArgs = null;
    mockFindMany.mockClear();
    mockFindUnique.mockClear();
    mockHydrateViewCounts.mockClear();
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
  });

  test("personalized Gusts use the same Network ranking path as fleets without requiring a client opt-in flag", async () => {
    const request = new Request(
      "http://localhost:3000/api/gusts?mode=personalized&profile=default"
    );
    await GET(request);
    expect(mockNetworkFeed).toHaveBeenCalledWith(
      request,
      "user1",
      "personalized",
      "gust"
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test("web Latest Gusts use the selected Network profile and a separate Gust candidate pool", async () => {
    const request = new Request(
      "http://localhost:3000/api/gusts?network=v2:default:2&profile=default"
    );
    await GET(request);
    expect(mockNetworkFeed).toHaveBeenCalledWith(
      request,
      "user1",
      "latest",
      "gust"
    );
  });

  test("new accounts and guests receive no adult Gusts until explicitly opted in", async () => {
    mockPostList = sampleGusts.map((post, index) => ({
      ...post,
      _count: { bookmarks: 0, comments: 0, responses: 0, vote: 5 },
      explicitContent: index === 0,
    }));
    const first = await GET(new Request("http://localhost:3000/api/gusts"));
    const firstPage = await first.json();
    expect(firstPage.posts.map((post: { id: string }) => post.id)).toEqual([
      "gust2",
    ]);
    mockGetSession.mockImplementationOnce(() => null);
    const guest = await GET(new Request("http://localhost:3000/api/gusts"));
    const guestPage = await guest.json();
    expect(guestPage.posts.map((post: { id: string }) => post.id)).toEqual([
      "gust2",
    ]);
    networkPreferences = { ...networkPreferences, showExplicitContent: true };
    const optedIn = await GET(new Request("http://localhost:3000/api/gusts"));
    const optedInPage = await optedIn.json();
    expect(optedInPage.posts).toHaveLength(2);
  });

  test("compound topic exclusions apply on Gust pages and cannot be bypassed by initialId", async () => {
    networkPreferences = { ...networkPreferences, avoidedTopics: ["furry"] };
    mockPostList = sampleGusts.map((post, index) => ({
      ...post,
      content: index === 0 ? "#FurryArt #furryimages" : "A landscape",
    }));
    const response = await GET(
      new Request("http://localhost:3000/api/gusts?initialId=gust1")
    );
    const page = await response.json();
    expect(page.posts.map((post: { id: string }) => post.id)).toEqual([
      "gust2",
    ]);
  });

  test("filtering preserves the served-page cursor so an excluded page can advance", async () => {
    networkPreferences = { ...networkPreferences, avoidedTopics: ["furry"] };
    mockPostList = Array.from({ length: 12 }, (_, index) => ({
      ...sampleGusts[0],
      content: "#furryart",
      id: `gust_${index}`,
    }));
    const response = await GET(new Request("http://localhost:3000/api/gusts"));
    expect(await response.json()).toEqual({ nextCursor: "gust_9", posts: [] });
  });

  test("fetches short-form video Gusts with isGust or video attachment filter", async () => {
    const req = new Request("http://localhost:3000/api/gusts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      nextCursor: string | null;
      posts: { id: string; isGust: boolean; viewCount: number }[];
    };

    expect(json.posts).toHaveLength(2);
    expect(json.posts[0].viewCount).toBe(42);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const callArgs = lastFindManyArgs as {
      where?: {
        isGust?: boolean;
        rootPostId?: null;
      };
    };
    expect(callArgs?.where?.isGust).toBe(true);
    expect(callArgs?.where?.rootPostId).toBeNull();
  });

  test("Following requires authentication and never falls back to the global stream", async () => {
    mockGetSession.mockImplementationOnce(() => null);
    const denied = await GET(
      new Request("http://localhost:3000/api/gusts?mode=following")
    );
    expect(denied.status).toBe(401);
    const response = await GET(
      new Request(
        "http://localhost:3000/api/gusts?mode=following&excludeModerated=1&take=5"
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "following",
      nextCursor: null,
      posts: [],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(mockFollowingGustsPage).toHaveBeenCalledWith({
      cursor: undefined,
      excludeModerated: true,
      pageSize: 5,
      userId: "user1",
    });
  });

  test("allows guests to browse engaged gusts without authentication", async () => {
    mockPostList = sampleGusts.map((post) => ({
      ...post,
      _count: { bookmarks: 0, comments: 0, responses: 0, vote: 5 },
    }));
    mockGetSession.mockImplementationOnce(() => null);

    const req = new Request("http://localhost:3000/api/gusts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      nextCursor: string | null;
      posts: unknown[];
    };
    expect(json.posts).toHaveLength(2);
  });

  test("handles cursor pagination and calculates nextCursor properly", async () => {
    // Generate 12 posts so pageSize (10) has a 11th post indicating more pages
    mockPostList = Array.from({ length: 12 }, (_, i) => ({
      attachments: [{ id: `m${i}`, type: "VIDEO" }],
      aura: 10 + i,
      createdAt: new Date(),
      id: `gust_${i}`,
      isGust: true,
      user: { id: "u1", username: "alice" },
    }));

    const req = new Request("http://localhost:3000/api/gusts?cursor=gust_0");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      nextCursor: string | null;
      posts: unknown[];
    };

    // Returns page size of 10 items
    expect(json.posts).toHaveLength(10);
    expect(json.nextCursor).toBe("gust_10");

    const callArgs = lastFindManyArgs as { cursor?: { id: string } };
    expect(callArgs?.cursor?.id).toBe("gust_0");
  });

  test("respects take parameter clamped up to 20", async () => {
    const req = new Request("http://localhost:3000/api/gusts?take=5");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const callArgs = lastFindManyArgs as { take?: number };
    // take + 1 for pagination lookahead
    expect(callArgs?.take).toBe(6);
  });

  test("restarts gust pagination when the cursor anchor is gone", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/gusts?cursor=exp.missing")
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { id: string }[] };
    expect(body.posts[0]?.id).toBe("gust1");
    expect(
      (lastFindManyArgs as { cursor?: { id: string } }).cursor
    ).toBeUndefined();
  });

  test("prepends requested initialId gust to the first page", async () => {
    const req = new Request("http://localhost:3000/api/gusts?initialId=gust2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      nextCursor: string | null;
      posts: { id: string }[];
    };

    expect(json.posts).toHaveLength(2);
    expect(json.posts[0].id).toBe("gust2");
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  test("does not prepend a moderated initialId gust when excludeModerated=1", async () => {
    const moderated = {
      attachments: [{ id: "m9", type: "VIDEO" }],
      aura: 5,
      createdAt: new Date("2026-01-01T08:00:00Z"),
      id: "gust-moderated",
      isGust: true,
      moderated: true,
      user: { id: "u3", username: "mallory" },
    };
    mockPostList = [...sampleGusts, moderated];

    const req = new Request(
      "http://localhost:3000/api/gusts?initialId=gust-moderated&excludeModerated=1"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      nextCursor: string | null;
      posts: { id: string; moderated?: boolean }[];
    };

    // The moderated gust is excluded: the findUnique where clause (moderated:
    // false) returns null, so it is never prepended.
    expect(json.posts).toHaveLength(2);
    expect(json.posts[0].id).toBe("gust1");
    expect(json.posts.some((p) => p.id === "gust-moderated")).toBe(false);
  });

  test("initialId pagination lookahead does not repeat posts on subsequent page", async () => {
    mockPostList = Array.from({ length: 15 }, (_, i) => ({
      attachments: [{ id: `m${i}`, type: "VIDEO" }],
      aura: 10 + i,
      createdAt: new Date(),
      id: `gust_${i}`,
      isGust: true,
      user: { id: "u1", username: "alice" },
    }));

    // Request initialId = gust_14 with take = 5
    const req1 = new Request(
      "http://localhost:3000/api/gusts?initialId=gust_14&take=5"
    );
    const res1 = await GET(req1);
    const json1 = (await res1.json()) as {
      nextCursor: string | null;
      posts: { id: string }[];
    };

    expect(json1.posts).toHaveLength(5);
    expect(json1.posts[0].id).toBe("gust_14");
    expect(json1.nextCursor).toBe("gust_3");

    // Request second page with returned cursor
    const req2 = new Request(
      `http://localhost:3000/api/gusts?cursor=${json1.nextCursor}&take=5`
    );
    const res2 = await GET(req2);
    const json2 = (await res2.json()) as {
      nextCursor: string | null;
      posts: { id: string }[];
    };

    expect(json2.posts[0]?.id).toBe("gust_4");
    const firstPageIds = new Set(json1.posts.map((p) => p.id));
    const secondPageIds = json2.posts.map((p) => p.id);
    for (const id of secondPageIds) {
      expect(firstPageIds.has(id)).toBe(false);
    }
  });
});
