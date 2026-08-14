import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "user1" },
}));

const sampleGusts = [
  {
    attachments: [{ id: "m1", type: "VIDEO" }],
    aura: 10,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    id: "gust1",
    isGust: true,
    user: { id: "u1", username: "alice" },
  },
  {
    attachments: [{ id: "m2", type: "VIDEO" }],
    aura: 25,
    createdAt: new Date("2026-01-01T09:00:00Z"),
    id: "gust2",
    isGust: true,
    user: { id: "u2", username: "bob" },
  },
];

let mockPostList = [...sampleGusts];
let lastFindManyArgs: unknown = null;

const mockFindMany = mock(
  (args: { cursor?: { id: string }; take?: number; where?: unknown }) => {
    lastFindManyArgs = args;
    const take = args?.take ?? 11;
    return mockPostList.slice(0, take);
  }
);

const mockHydrateViewCounts = mock((posts: unknown[]) =>
  posts.map((p) => ({ ...(p as Record<string, unknown>), viewCount: 42 }))
);

mock.module("@asm/db", () => ({
  MediaType: {
    AUDIO: "AUDIO",
    IMAGE: "IMAGE",
    VIDEO: "VIDEO",
  },
  getPostDataInclude: (viewerId: string) => ({
    user: true,
    vote: !!viewerId,
  }),
  hydrateViewCounts: mockHydrateViewCounts,
  prisma: {
    post: {
      findMany: mockFindMany,
    },
  },
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/gusts", () => {
  beforeEach(() => {
    mockPostList = [...sampleGusts];
    lastFindManyArgs = null;
    mockFindMany.mockClear();
    mockHydrateViewCounts.mockClear();
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
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
      };
    };
    expect(callArgs?.where?.isGust).toBe(true);
  });

  test("allows guests to browse gusts without authentication", async () => {
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
});
