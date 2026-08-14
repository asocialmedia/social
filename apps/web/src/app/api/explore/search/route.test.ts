import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "u1" },
}));

let lastPostFindManyArgs: unknown = null;
let _lastUserFindManyArgs: unknown = null;

const mockPostFindMany = mock((args: unknown) => {
  lastPostFindManyArgs = args;
  return Promise.resolve([
    {
      aura: 50,
      content: "amazing viral gust",
      id: "p1",
      isGust: true,
    },
  ]);
});

const mockUserFindMany = mock((args: unknown) => {
  _lastUserFindManyArgs = args;
  return Promise.resolve([
    {
      aura: 100,
      displayName: "Alice",
      id: "u1",
      username: "alice",
    },
  ]);
});

const mockHydrateViewCounts = mock((posts: unknown[]) =>
  Promise.resolve(posts)
);

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  getUserDataSelect: () => ({ id: true }),
  hydrateViewCounts: mockHydrateViewCounts,
  prisma: {
    post: {
      findMany: mockPostFindMany,
    },
    user: {
      findMany: mockUserFindMany,
    },
  },
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/explore/search", () => {
  beforeEach(() => {
    lastPostFindManyArgs = null;
    _lastUserFindManyArgs = null;
    mockPostFindMany.mockClear();
    mockUserFindMany.mockClear();
    mockHydrateViewCounts.mockClear();
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "u1" } }));
  });

  test("returns empty arrays when query string is empty", async () => {
    const req = new Request("http://localhost:3000/api/explore/search?q=");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { posts: unknown[]; users: unknown[] };
    expect(json.posts).toEqual([]);
    expect(json.users).toEqual([]);
    expect(mockPostFindMany).not.toHaveBeenCalled();
  });

  test("filters by isGust: true when tab=gusts", async () => {
    const req = new Request(
      "http://localhost:3000/api/explore/search?q=viral&tab=gusts"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const postArgs = lastPostFindManyArgs as {
      where?: {
        content?: { contains?: string };
        isGust?: boolean;
      };
    };
    expect(postArgs?.where?.content?.contains).toBe("viral");
    expect(postArgs?.where?.isGust).toBe(true);
  });

  test("orders by aura desc when tab=trending", async () => {
    const req = new Request(
      "http://localhost:3000/api/explore/search?q=trend&tab=trending"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const postArgs = lastPostFindManyArgs as {
      orderBy?: { aura?: string }[];
    };
    expect(postArgs?.orderBy?.[0]?.aura).toBe("desc");
  });
});
