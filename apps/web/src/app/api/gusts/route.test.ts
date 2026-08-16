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
  (args: {
    cursor?: { id: string };
    take?: number;
    where?: { id?: { not?: string } };
  }) => {
    lastFindManyArgs = args;
    const take = args?.take ?? 11;
    let list = mockPostList;
    if (args?.where?.id?.not) {
      list = list.filter((p) => p.id !== args.where?.id?.not);
    }
    if (args?.cursor?.id) {
      const cursorIndex = list.findIndex((p) => p.id === args.cursor?.id);
      if (cursorIndex !== -1) {
        list = list.slice(cursorIndex);
      }
    }
    return list.slice(0, take);
  }
);

const mockHydrateViewCounts = mock((posts: unknown[]) =>
  posts.map((p) => ({ ...(p as Record<string, unknown>), viewCount: 42 }))
);

const mockFindUnique = mock(
  (args: { where?: { id?: string } }) =>
    mockPostList.find((g) => g.id === args?.where?.id) ?? null
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
      findUnique: mockFindUnique,
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
    expect(json1.nextCursor).toBe("gust_4");

    // Request second page with returned cursor
    const req2 = new Request(
      `http://localhost:3000/api/gusts?cursor=${json1.nextCursor}&take=5`
    );
    const res2 = await GET(req2);
    const json2 = (await res2.json()) as {
      nextCursor: string | null;
      posts: { id: string }[];
    };

    const firstPageIds = new Set(json1.posts.map((p) => p.id));
    const secondPageIds = json2.posts.map((p) => p.id);
    for (const id of secondPageIds) {
      expect(firstPageIds.has(id)).toBe(false);
    }
  });
});
