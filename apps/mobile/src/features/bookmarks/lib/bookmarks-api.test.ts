import { describe, expect, test } from "bun:test";

import {
  fetchBookmarkedHn,
  fetchBookmarkedPage,
  fetchBookmarkedPosts,
  fetchLikedPage,
  fetchLikedPosts,
} from "./bookmarks-api";

describe("native bookmarks API", () => {
  test("preserves pagination cursors for bookmarks and likes", async () => {
    const calls: string[] = [];
    const baseFetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        Response.json({ nextCursor: "next-page", posts: [] })
      );
    }) as unknown as typeof fetch;
    const options = { apiBase: "https://api.test", baseFetch };
    const bookmarks = await fetchBookmarkedPage(
      "gusts",
      options,
      "next cursor"
    );
    const likes = await fetchLikedPage(options, "next cursor");
    expect(bookmarks.nextCursor).toBe("next-page");
    expect(likes.nextCursor).toBe("next-page");
    expect(calls).toEqual([
      "https://api.test/api/posts/bookmarked?filter=gusts&cursor=next+cursor",
      "https://api.test/api/posts/liked?cursor=next%20cursor",
    ]);
  });

  test("HN bookmarks retain timestamps, comments and attachment metadata", async () => {
    const baseFetch = (() =>
      Promise.resolve(
        Response.json({
          stories: [
            {
              by: "alice",
              descendants: 12,
              id: 42,
              score: 8,
              time: 1_791_910_800,
              title: "Native release",
              url: "https://www.example.com/story",
            },
          ],
        })
      )) as unknown as typeof fetch;
    const rows = await fetchBookmarkedHn({
      apiBase: "https://api.test",
      baseFetch,
    });
    expect(rows[0]).toEqual({
      by: "alice",
      comments: 12,
      domain: "example.com",
      id: 42,
      score: 8,
      time: 1_791_910_800,
      title: "Native release",
      url: "https://www.example.com/story",
    });
  });

  test("HN failures remain retryable instead of appearing as empty bookmarks", async () => {
    const baseFetch = (() =>
      Promise.resolve(
        new Response(null, { status: 503 })
      )) as unknown as typeof fetch;
    await expect(
      fetchBookmarkedHn({ apiBase: "https://api.test", baseFetch })
    ).rejects.toThrow("503");
  });

  test("requests regular and gust bookmark feeds", async () => {
    const calls: string[] = [];
    const baseFetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(Response.json({ nextCursor: null, posts: [] }));
    }) as unknown as typeof fetch;

    await fetchBookmarkedPosts("posts", {
      apiBase: "https://api.test",
      baseFetch,
    });
    await fetchBookmarkedPosts("gusts", {
      apiBase: "https://api.test",
      baseFetch,
    });
    await fetchLikedPosts({ apiBase: "https://api.test", baseFetch });

    expect(calls).toEqual([
      "https://api.test/api/posts/bookmarked",
      "https://api.test/api/posts/bookmarked?filter=gusts",
      "https://api.test/api/posts/liked",
    ]);
  });
});
