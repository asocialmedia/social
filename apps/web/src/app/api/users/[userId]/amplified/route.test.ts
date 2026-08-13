import { beforeEach, describe, expect, mock, test } from "bun:test";

const USER_ID = "user1";
const PROFILE_ID = "profile1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const votes = [
  { postId: "post2", createdAt: new Date("2026-01-03T00:00:00Z") },
  { postId: "post1", createdAt: new Date("2026-01-02T00:00:00Z") },
];

const posts = [
  { id: "post1", content: "one", user: { id: "author1" }, viewCount: 5 },
  { id: "post2", content: "two", user: { id: "author2" }, viewCount: 10 },
];

let lastWhere: unknown;
let lastTake: number;

const mockPrisma = {
  vote: {
    findMany: (args: {
      take: number;
      where: { userId: string; value: number };
    }) => {
      lastWhere = args.where;
      lastTake = args.take;
      return [...votes];
    },
  },
  post: {
    findMany: () => [...posts],
  },
};

const mockHydrate = mock((items: unknown[]) => items);

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrate,
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ userId: PROFILE_ID }) };

describe("GET /api/users/[userId]/amplified", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockHydrate.mockClear();
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
    mockPrisma.vote.findMany = () => [];

    const res = await GET(
      new Request("http://localhost/api/users/x/amplified"),
      context
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ nextCursor: null, posts: [] });
  });
});
