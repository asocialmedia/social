import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

let lastStoryIds: number[] = [];

const mockPrisma = {
  orm: {
    public: {
      HNBookmark: {
        select: () => ({
          where: (
            predicate: (bookmark: {
              storyId: { in: (ids: number[]) => unknown };
              userId: { eq: (id: string) => unknown };
            }) => unknown
          ) => {
            predicate({
              storyId: {
                in: (ids) => {
                  lastStoryIds = ids;
                  return {};
                },
              },
              userId: { eq: () => ({}) },
            });
            return {
              all: () => [{ storyId: 1001 }, { storyId: 1003 }],
            };
          },
        }),
      },
    },
  },
};

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
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
