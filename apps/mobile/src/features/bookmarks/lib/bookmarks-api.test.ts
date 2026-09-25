import { describe, expect, test } from "bun:test";

import { fetchBookmarkedPosts, fetchLikedPosts } from "./bookmarks-api";

describe("native bookmarks API", () => {
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
