import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

const USER_ID = "user1";
const PROFILE_ID = "profile1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const votes = [
  { createdAt: new Date("2026-01-03T00:00:00Z"), postId: "post2" },
  { createdAt: new Date("2026-01-02T00:00:00Z"), postId: "post1" },
];

const posts = [
  { content: "one", id: "post1", user: { id: "author1" }, viewCount: 5 },
  { content: "two", id: "post2", user: { id: "author2" }, viewCount: 10 },
];

let lastWhere: unknown;
let lastTake: number;
let voteRows = [...votes];

interface VoteQuery {
  all: () => Promise<(typeof votes)[number][]>;
  cursor: (cursor: { postId: string }) => VoteQuery;
  limit: (take: number) => VoteQuery;
  offset: (offset: number) => VoteQuery;
  orderBy: (order: unknown[]) => VoteQuery;
  where: (
    where: (vote: {
      userId: { eq: (id: string) => unknown };
      value: { eq: (value: number) => unknown };
    }) => unknown
  ) => VoteQuery;
}

function createVoteQuery(): VoteQuery {
  return {
    all: () => Promise.resolve([...voteRows]),
    cursor: () => createVoteQuery(),
    limit: (take) => {
      lastTake = take;
      return createVoteQuery();
    },
    offset: () => createVoteQuery(),
    orderBy: () => createVoteQuery(),
    where: (predicate) => {
      let userId = "";
      let value = 0;
      predicate({
        userId: {
          eq: (id) => {
            userId = id;
            return {};
          },
        },
        value: {
          eq: (nextValue) => {
            value = nextValue;
            return {};
          },
        },
      });
      lastWhere = { userId, value };
      return createVoteQuery();
    },
  };
}

const mockPrisma = {
  orm: {
    public: {
      Votes: { select: () => createVoteQuery() },
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

const context = { params: Promise.resolve({ userId: PROFILE_ID }) };

describe("GET /api/users/[userId]/amplified", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
    lastWhere = null;
    lastTake = 0;
    voteRows = [...votes];
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(
      new Request("http://localhost/api/users/x/amplified"),
      context
    );

    expect(res.status).toBe(401);
  });

  test("returns only amplified posts for the given user", async () => {
    const res = await GET(
      new Request("http://localhost/api/users/x/amplified"),
      context
    );

    expect(res.status).toBe(200);
    expect(lastWhere).toEqual({ userId: PROFILE_ID, value: 1 });
    expect(lastTake).toBe(21);
    const body = await res.json();
    // Vote recency order preserved (post2 amplified most recently).
    expect(body.posts.map((post: { id: string }) => post.id)).toEqual([
      "post2",
      "post1",
    ]);
    expect(mockHydrate).toHaveBeenCalled();
  });

  test("returns an empty list when the user has no amplified posts", async () => {
    voteRows = [];

    const res = await GET(
      new Request("http://localhost/api/users/x/amplified"),
      context
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ nextCursor: null, posts: [] });
  });
});
