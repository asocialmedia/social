import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

const USER_ID = "user1";
const POST_ID = "post1";
const BSKY_URI = "at://did:plc:12345/app.bsky.feed.post/abcdef12345";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

let upserted = false;
let redisZaddCalls: [string, number, string][] = [];
let upsertedSnapshots: unknown[] = [];
let mockCachedPost: { available: boolean } | null = null;

const mockPrisma = {
  orm: {
    public: {
      ExternalEngagements: {
        upsert: () => ({}),
      },
      PostVisits: {
        upsert: () => {
          upserted = true;
          return {};
        },
      },
      Posts: {
        select: () => ({
          where: (where: { id: string }) => ({
            first: () =>
              Promise.resolve(where.id === POST_ID ? { id: POST_ID } : null),
          }),
        }),
      },
    },
  },
};

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  findExternalPost: () => Promise.resolve(mockCachedPost),
  prisma: mockPrisma,
  recordExternalPostVisit: (_userId: string, post: unknown) => {
    upsertedSnapshots.push(post);
    return Promise.resolve("snapshot-id");
  },
  redis: {
    ...asmDbMockBase.redis,
    zadd: (key: string, score: number, member: string) => {
      redisZaddCalls.push([key, score, member]);
      return Promise.resolve(1);
    },
    zremrangebyrank: () => Promise.resolve(0),
  },
  upsertExternalPostSnapshot: (snapshot: unknown) => {
    upsertedSnapshots.push(snapshot);
    return Promise.resolve("snapshot-id");
  },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("POST /api/posts/visit", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    upserted = false;
    redisZaddCalls = [];
    upsertedSnapshots = [];
    mockCachedPost = null;
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({ postId: POST_ID }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(401);
    expect(upserted).toBe(false);
  });

  test("rejects requests without a postId", async () => {
    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(400);
    expect(upserted).toBe(false);
  });

  test("returns 404 for a missing post", async () => {
    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({ postId: "missing" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(404);
    expect(upserted).toBe(false);
  });

  test("records the visit for an authenticated user", async () => {
    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({ postId: POST_ID }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(200);
    expect(upserted).toBe(true);
    expect(redisZaddCalls).toHaveLength(1);
    expect(redisZaddCalls[0]?.[0]).toBe(`user:post-visits:${USER_ID}`);
    expect(redisZaddCalls[0]?.[2]).toBe(`asm:${POST_ID}`);
  });

  test("records visit for a bluesky post with externalPost payload", async () => {
    const externalPost = {
      author: {
        avatarUrl: "https://avatar.test/pic.jpg",
        description: "Bio",
        displayName: "Alice",
        handle: "alice.bsky.social",
        id: "did:plc:12345",
        labels: [],
        source: "bluesky" as const,
        upstreamCounts: { followers: 1, following: 1, posts: 1 },
        url: "https://bsky.app/profile/alice.bsky.social",
      },
      createdAt: new Date().toISOString(),
      id: BSKY_URI,
      indexedAt: new Date().toISOString(),
      labels: [],
      languages: ["en"],
      media: [],
      revision: "rev1",
      segments: [{ text: "Hello from Bluesky!" }],
      source: "bluesky",
      text: "Hello from Bluesky!",
      upstreamCounts: { likes: 5, quotes: 0, replies: 2, reposts: 1 },
      url: "https://bsky.app/profile/alice.bsky.social/post/123",
    };

    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({
          externalPost,
          postId: BSKY_URI,
          uri: BSKY_URI,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, type: "bluesky" });
    expect(upsertedSnapshots).toHaveLength(1);
    expect(redisZaddCalls).toHaveLength(1);
    expect(redisZaddCalls[0]?.[0]).toBe(`user:post-visits:${USER_ID}`);
    expect(redisZaddCalls[0]?.[2]).toBe(`bsky:${BSKY_URI}`);
  });

  test("returns 404 when bluesky post is cached as unavailable/deleted", async () => {
    mockCachedPost = { available: false };

    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({
          postId: BSKY_URI,
          uri: BSKY_URI,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Post deleted");
  });
});
