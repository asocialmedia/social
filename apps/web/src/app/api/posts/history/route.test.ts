import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const visits = [{ postId: "post2" }, { postId: "post1" }, { postId: "post3" }];

const posts = [
  { content: "one", id: "post1", moderated: false, user: { id: "author1" } },
  { content: "two", id: "post2", moderated: false, user: { id: "author2" } },
  { content: "three", id: "post3", moderated: false, user: { id: "author3" } },
];

let lastTake: number;
let visitRows = [...visits];
let mockRedisMembers: string[] = [];
let redisZremCalls: [string, string[]][] = [];
let refreshedPosts: [string, unknown][] = [];

interface VisitQuery {
  all: () => Promise<{ postId: string }[]>;
  limit: (take: number) => VisitQuery;
  orderBy: () => VisitQuery;
  where: () => VisitQuery;
}

function createVisitQuery(_take?: number): VisitQuery {
  return {
    all: () => Promise.resolve([...visitRows]),
    limit: (nextTake) => {
      lastTake = nextTake;
      return createVisitQuery(nextTake);
    },
    orderBy: () => createVisitQuery(),
    where: () => createVisitQuery(),
  };
}

const mockPrisma = {
  orm: {
    public: {
      ExternalPosts: {
        where: () => ({
          all: () => Promise.resolve([]),
        }),
      },
      PostVisits: {
        select: () => createVisitQuery(),
      },
    },
  },
};

const mockHydrate = mock((items: unknown[]) => items);

const mockGetPosts = mock(
  (
    _uris: string[]
  ): Promise<
    {
      author: {
        avatarUrl: string;
        description: string;
        displayName: string;
        handle: string;
        id: string;
        labels: string[];
        source: "bluesky";
        upstreamCounts: { followers: number; following: number; posts: number };
        url: string;
      };
      createdAt: string;
      id: string;
      indexedAt: string;
      labels: string[];
      languages: string[];
      media: { alt: string; type: "image"; url: string }[];
      revision: string;
      segments: { text: string }[];
      source: "bluesky";
      text: string;
      upstreamCounts: {
        likes: number;
        quotes: number;
        replies: number;
        reposts: number;
      };
      url: string;
    }[]
  > => Promise.resolve([])
);

mock.module("@asm/protocols/bluesky", () => ({
  BlueskyClient: class {
    getPosts = mockGetPosts;
  },
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  externalPostStates: () =>
    Promise.resolve(
      new Map([
        [
          "at://did:plc:123/app.bsky.feed.post/1",
          {
            amplifications: 0,
            amplified: false,
            bookmarked: false,
            comments: 1,
            responses: 0,
          },
        ],
      ])
    ),
  getPostDataQuery: () => ({ where: () => ({ all: () => [...posts] }) }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
  redis: {
    ...asmDbMockBase.redis,
    zrem: (key: string, ...members: string[]) => {
      redisZremCalls.push([key, members]);
      return Promise.resolve(1);
    },
    zrevrange: () => Promise.resolve(mockRedisMembers),
  },
  refreshExternalPost: (uri: string, post: unknown) => {
    refreshedPosts.push([uri, post]);
    return Promise.resolve();
  },
  upsertExternalPostSnapshot: () => Promise.resolve("snapshot-id"),
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/history", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
    mockGetPosts.mockClear();
    visitRows = [...visits];
    mockRedisMembers = [];
    redisZremCalls = [];
    refreshedPosts = [];
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  test("limits to 12 most recent visited posts via Postgres fallback", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(lastTake).toBe(12);
    const body = await res.json();
    // Order follows visit recency (post2 visited most recently).
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
      "post2",
      "post1",
      "post3",
    ]);
  });

  test("returns an empty list when there is no history", async () => {
    visitRows = [];

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ posts: [] });
  });

  test("returns mixed ASM and Bluesky posts from Redis in visit order and prunes deleted Bluesky posts", async () => {
    const bskyLiveUri = "at://did:plc:123/app.bsky.feed.post/1";
    const bskyDeletedUri = "at://did:plc:123/app.bsky.feed.post/deleted";

    mockRedisMembers = [
      `bsky:${bskyLiveUri}`,
      "asm:post1",
      `bsky:${bskyDeletedUri}`,
    ];

    mockGetPosts.mockResolvedValueOnce([
      {
        author: {
          avatarUrl: "https://avatar.test/pic.jpg",
          description: "Bio",
          displayName: "Alice",
          handle: "alice.bsky.social",
          id: "did:plc:123",
          labels: [],
          source: "bluesky",
          upstreamCounts: { followers: 1, following: 1, posts: 1 },
          url: "https://bsky.app/profile/alice.bsky.social",
        },
        createdAt: "2026-10-17T20:00:00.000Z",
        id: bskyLiveUri,
        indexedAt: "2026-10-17T20:00:00.000Z",
        labels: [],
        languages: ["en"],
        media: [
          {
            alt: "photo",
            type: "image",
            url: "https://bsky.app/img/photo.jpg",
          },
        ],
        revision: "rev1",
        segments: [{ text: "Bluesky post" }],
        source: "bluesky",
        text: "Bluesky post",
        upstreamCounts: { likes: 10, quotes: 0, replies: 2, reposts: 3 },
        url: "https://bsky.app/profile/alice.bsky.social/post/1",
      },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toHaveLength(2);

    // First is the live Bluesky post
    expect(body.posts[0].id).toBe(bskyLiveUri);
    expect(body.posts[0].external).toBeDefined();
    expect(body.posts[0].external.id).toBe(bskyLiveUri);
    expect(body.posts[0].attachments).toHaveLength(1);
    expect(body.posts[0].attachments[0].id).toBe(
      "https://bsky.app/img/photo.jpg"
    );

    // Second is the ASM post
    expect(body.posts[1].id).toBe("post1");

    // Deleted post was pruned
    expect(refreshedPosts).toEqual([[bskyDeletedUri, null]]);
    expect(
      redisZremCalls.some((call) =>
        call[1].some((m) => m.includes(bskyDeletedUri))
      )
    ).toBe(true);
  });
});
