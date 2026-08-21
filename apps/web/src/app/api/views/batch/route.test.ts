import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "user1" },
}));

// Persisted viewCounts the route reads from Postgres before incrementing.
const persistedById = new Map<string, number>([
  ["post1", 100],
  ["post2", 5],
]);

// Simulates the Redis counter: the delta since the last worker flush, starting
// fresh at 1 for every post on first touch.
const deltas = new Map<string, number>();
const mockIncrementView = mock((postId: string) => {
  const next = (deltas.get(postId) ?? 0) + 1;
  deltas.set(postId, next);
  return next;
});

const mockFindMany = mock((args: { where?: { id?: { in?: string[] } } }) => {
  const ids = args?.where?.id?.in ?? [];
  return ids
    .map((id) =>
      persistedById.has(id)
        ? { id, viewCount: persistedById.get(id) as number }
        : null
    )
    .filter((post): post is { id: string; viewCount: number } => post !== null);
});

mock.module("@asm/db", () => ({
  postViewsCache: {
    incrementView: mockIncrementView,
  },
  prisma: {
    post: {
      findMany: mockFindMany,
    },
  },
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("POST /api/views/batch", () => {
  beforeEach(() => {
    deltas.clear();
    mockIncrementView.mockClear();
    mockFindMany.mockClear();
    mockGetSession.mockClear();
  });

  test("returns persisted + delta totals, not the raw Redis delta", async () => {
    const req = new Request("http://localhost:3000/api/views/batch", {
      body: JSON.stringify({ postIds: ["post1", "post2"] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: Record<string, number>;
      success: boolean;
    };

    // persisted 100 + delta 1, persisted 5 + delta 1
    expect(json.success).toBe(true);
    expect(json.results).toEqual({ post1: 101, post2: 6 });
    expect(mockIncrementView).toHaveBeenCalledTimes(2);
    expect(mockIncrementView).toHaveBeenCalledWith("post1", {
      userId: "user1",
    });
    expect(mockIncrementView).toHaveBeenCalledWith("post2", {
      userId: "user1",
    });
  });

  test("reads persisted counts before incrementing", async () => {
    const req = new Request("http://localhost:3000/api/views/batch", {
      body: JSON.stringify({ postIds: ["post1"] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    await POST(req);

    // The persisted read must happen before the first increment so a flush
    // racing the request can't double count.
    const findManyOrder = mockFindMany.mock.invocationCallOrder[0] as number;
    const incrementOrder = mockIncrementView.mock
      .invocationCallOrder[0] as number;
    expect(findManyOrder).toBeLessThan(incrementOrder);
  });

  test("treats unknown post ids as zero persisted", async () => {
    const req = new Request("http://localhost:3000/api/views/batch", {
      body: JSON.stringify({ postIds: ["missing-post"] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req);
    const json = (await res.json()) as { results: Record<string, number> };

    expect(json.results).toEqual({ "missing-post": 1 });
  });
});
