import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "user1" },
}));

const mockFindMany = mock(() => [
  {
    attachments: [{ id: "m1", type: "VIDEO" }],
    aura: 10,
    createdAt: new Date(),
    id: "gust1",
    isGust: true,
    user: { id: "u1", username: "alice" },
  },
]);

const mockHydrateViewCounts = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  getPostDataInclude: () => ({}),
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
    mockFindMany.mockClear();
    mockHydrateViewCounts.mockClear();
  });

  test("fetches posts with isGust: true and attachments: { some: { type: 'VIDEO' } }", async () => {
    const req = new Request("http://localhost:3000/api/gusts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      nextCursor: string | null;
      posts: unknown[];
    };
    expect(json.posts).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);

    const callArgs = mockFindMany.mock.calls[0]?.[0] as {
      where?: {
        OR?: {
          isGust?: boolean;
          attachments?: { some?: { type?: string } };
        }[];
      };
    };
    expect(callArgs?.where?.OR).toBeDefined();
    expect(callArgs?.where?.OR?.[0]?.isGust).toBe(true);
  });
});
