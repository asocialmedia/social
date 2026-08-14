import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

let lastStoryIds: number[] = [];

const mockPrisma = {
  hNBookmark: {
    findMany: (args: {
      select: { storyId: boolean };
      where: { storyId: { in: number[] }; userId: string };
    }) => {
      lastStoryIds = args.where.storyId.in;
      return [{ storyId: 1001 }, { storyId: 1003 }];
    },
  },
};

mock.module("@asm/db", () => ({
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("POST /api/hackernews/bookmark-states", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    lastStoryIds = [];
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://localhost/api/hackernews/bookmark-states", {
        body: JSON.stringify({ storyIds: [1001, 1002] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(401);
  });

  test("returns bookmark states for the given stories", async () => {
    const res = await POST(
      new Request("http://localhost/api/hackernews/bookmark-states", {
        body: JSON.stringify({ storyIds: [1001, 1002, 1003] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      bookmarked: { 1001: true, 1003: true },
    });
    expect(lastStoryIds).toEqual([1001, 1002, 1003]);
  });

  test("returns an empty map when no story ids are provided", async () => {
    const res = await POST(
      new Request("http://localhost/api/hackernews/bookmark-states", {
        body: JSON.stringify({ storyIds: [] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ bookmarked: {} });
  });

  test("ignores non-integer story ids", async () => {
    const res = await POST(
      new Request("http://localhost/api/hackernews/bookmark-states", {
        body: JSON.stringify({ storyIds: [1001, "abc", null] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      bookmarked: { 1001: true, 1003: true },
    });
    expect(lastStoryIds).toEqual([1001]);
  });
});
