import { beforeEach, describe, expect, mock, test } from "bun:test";

let lastFindManyArgs: {
  skip?: number;
  take?: number;
  where?: unknown;
} | null = null;

const mockPrisma = {
  post: {
    findMany: mock((args: typeof lastFindManyArgs) => {
      lastFindManyArgs = args;
      return [
        { id: "post-1", rootPostId: null },
        { id: "post-2", rootPostId: "post-1" },
      ];
    }),
  },
};

const mockHydrateViewCounts = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({ user: true }),
  hydrateViewCounts: mockHydrateViewCounts,
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => null,
}));

describe("GET /api/posts/latest", () => {
  beforeEach(() => {
    lastFindManyArgs = null;
    mockPrisma.post.findMany.mockClear();
    mockHydrateViewCounts.mockClear();
  });

  test("scopes the latest feed to top-level posts", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/posts/latest?take=20")
    );

    expect(response.status).toBe(200);
    expect(lastFindManyArgs?.where).toEqual({
      isGust: false,
      rootPostId: null,
    });
    expect(lastFindManyArgs?.take).toBe(21);
    expect(lastFindManyArgs?.skip).toBe(0);
  });

  test("keeps moderation filtering alongside the top-level constraint", async () => {
    const { GET } = await import("./route");

    await GET(
      new Request("http://localhost/api/posts/latest?excludeModerated=1")
    );

    expect(lastFindManyArgs?.where).toEqual({
      isGust: false,
      moderated: false,
      rootPostId: null,
    });
  });
});
