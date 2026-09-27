// Unit tests for post-api helpers, specifically verifying that fetchRelatedPosts
// excludes gusts and the current post from recommendations under "View more content".
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { fetchRelatedPosts } from "./post-api";

describe("fetchRelatedPosts", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("excludes gusts from recommended posts", async () => {
    const mockPosts = [
      {
        content: "A regular fleet post",
        createdAt: "2026-09-26T10:00:00.000Z",
        id: "post-1",
        isGust: false,
        userId: "user-1",
      },
      {
        content: "A video gust clip",
        createdAt: "2026-09-26T11:00:00.000Z",
        id: "post-gust",
        isGust: true,
        userId: "user-2",
      },
      {
        content: "Another fleet post",
        createdAt: "2026-09-26T12:00:00.000Z",
        id: "post-2",
        isGust: false,
        userId: "user-3",
      },
    ];

    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ posts: mockPosts }, { status: 200 }))
    ) as unknown as typeof fetch;

    const result = await fetchRelatedPosts("origin-id", {
      apiBase: "https://example.com",
    });

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(["post-1", "post-2"]);
    expect(result.some((p) => p.isGust)).toBe(false);
  });

  test("excludes the origin post itself", async () => {
    const mockPosts = [
      {
        content: "The origin post",
        createdAt: "2026-09-26T10:00:00.000Z",
        id: "origin-id",
        isGust: false,
        userId: "user-1",
      },
      {
        content: "Other post",
        createdAt: "2026-09-26T12:00:00.000Z",
        id: "post-other",
        isGust: false,
        userId: "user-2",
      },
    ];

    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ posts: mockPosts }, { status: 200 }))
    ) as unknown as typeof fetch;

    const result = await fetchRelatedPosts("origin-id", {
      apiBase: "https://example.com",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("post-other");
  });

  test("returns empty array on non-ok response or invalid payload", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not found", { status: 404 }))
    ) as unknown as typeof fetch;

    const notOkResult = await fetchRelatedPosts("origin-id", {
      apiBase: "https://example.com",
    });
    expect(notOkResult).toEqual([]);

    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ posts: "not-an-array" }, { status: 200 }))
    ) as unknown as typeof fetch;

    const invalidResult = await fetchRelatedPosts("origin-id", {
      apiBase: "https://example.com",
    });
    expect(invalidResult).toEqual([]);
  });
});
