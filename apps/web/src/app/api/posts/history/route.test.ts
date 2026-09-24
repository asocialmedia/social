import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const visits = [{ postId: "post2" }, { postId: "post1" }, { postId: "post3" }];

const posts = [
  { content: "one", id: "post1", user: { id: "author1" } },
  { content: "two", id: "post2", user: { id: "author2" } },
  { content: "three", id: "post3", user: { id: "author3" } },
];

let lastTake: number;
let visitRows = [...visits];

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
      PostVisits: {
        select: () => createVisitQuery(),
      },
    },
  },
};

const mockHydrate = mock((items: unknown[]) => items);

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getPostDataQuery: () => ({ where: () => ({ all: () => [...posts] }) }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/history", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
    visitRows = [...visits];
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  test("limits to 12 most recent visited posts", async () => {
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
});
