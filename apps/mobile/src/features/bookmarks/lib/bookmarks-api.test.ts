import { describe, expect, test } from "bun:test";

import {
  BOOKMARK_TAB_COPY,
  bookmarkTabCount,
  fetchBookmarkCounts,
  fetchBookmarkedHn,
  fetchBookmarkedPage,
  fetchBookmarkedPosts,
  fetchLikedPage,
  fetchLikedPosts,
  parseBookmarkCounts,
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

  test("reads per-tab bookmark counts and drops junk values", async () => {
    const calls: string[] = [];
    const baseFetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        Response.json({ gustCount: 3, hnCount: "x", postCount: -2 })
      );
    }) as unknown as typeof fetch;
    const counts = await fetchBookmarkCounts({
      apiBase: "https://api.test",
      baseFetch,
    });
    expect(calls).toEqual(["https://api.test/api/bookmarks/count"]);
    expect(counts).toEqual({ gustCount: 3, hnCount: 0, postCount: 0 });
  });

  test("tab badges follow web: likes never carry a count", () => {
    const counts = parseBookmarkCounts({
      gustCount: 2,
      hnCount: 4,
      postCount: 7,
    });
    expect(bookmarkTabCount("posts", counts)).toBe(7);
    expect(bookmarkTabCount("gusts", counts)).toBe(2);
    expect(bookmarkTabCount("hackernews", counts)).toBe(4);
    expect(bookmarkTabCount("likes", counts)).toBe(0);
    expect(bookmarkTabCount("posts", null)).toBe(0);
  });

  test("every tab has web's empty and error copy", () => {
    expect(BOOKMARK_TAB_COPY.posts.title).toBe(
      "You don't have any bookmarks yet."
    );
    expect(BOOKMARK_TAB_COPY.likes.error).toBe(
      "An error occurred while loading liked posts."
    );
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
