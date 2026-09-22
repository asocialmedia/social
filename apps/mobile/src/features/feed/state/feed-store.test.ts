import { describe, expect, test } from "bun:test";

import type { FeedPost } from "../lib/feed-types";
import { FeedCache, flattenUniquePosts, prependPosts } from "./feed-store";

function post(id: string): FeedPost {
  return {
    _count: { comments: 0, mentions: 0, vote: 0 },
    attachments: [],
    bookmarks: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    id,
    mentions: [],
    tags: [],
    userId: "u",
    vote: [],
  };
}

describe("flattenUniquePosts", () => {
  test("dedupes across pages", () => {
    expect(
      flattenUniquePosts([
        [post("a"), post("b")],
        [post("b"), post("c")],
      ]).map((item) => item.id)
    ).toEqual(["a", "b", "c"]);
  });
});

describe("prependPosts", () => {
  test("prepends unseen to page one only", () => {
    const { added, pages } = prependPosts(
      [[post("b")], [post("c")]],
      [post("a"), post("b")]
    );
    expect(added).toBe(true);
    expect(pages[0]?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(pages[1]?.map((item) => item.id)).toEqual(["c"]);
  });

  test("no-ops on empty input or empty cache", () => {
    expect(prependPosts([[post("a")]], []).added).toBe(false);
    expect(prependPosts([], [post("a")]).added).toBe(false);
    expect(prependPosts([[post("a")]], [post("a")]).added).toBe(false);
  });
});

describe("FeedCache", () => {
  test("applies pages with dedupe-ready shape", () => {
    const cache = new FeedCache();
    const feed = cache.applyPage("k", [post("a")], "c1", {}, false);
    expect(feed.status).toBe("success");
    expect(feed.hasMore).toBe(true);
    expect(feed.cursor).toBe("c1");
    const appended = cache.applyPage("k", [post("b")], null, {}, true);
    expect(appended.pages).toHaveLength(2);
    expect(appended.hasMore).toBe(false);
  });

  test("missing keys read as idle", () => {
    expect(new FeedCache().get("nope").status).toBe("idle");
  });

  test("retention drops old entries", () => {
    let now = 1000;
    const cache = new FeedCache(() => now);
    cache.applyPage("k", [post("a")], null, {}, false);
    now += 31 * 60 * 1000;
    expect(cache.get("k").status).toBe("idle");
  });

  test("invalidate marks stale, clear drops all", () => {
    const cache = new FeedCache();
    cache.applyPage("a", [post("x")], null, {}, false);
    cache.applyPage("b", [post("y")], null, {}, false);
    cache.invalidate("a");
    expect(cache.get("a").stale).toBe(true);
    expect(cache.get("b").stale).toBe(false);
    cache.invalidateAll();
    expect(cache.get("b").stale).toBe(true);
    cache.clear();
    expect(cache.get("a").status).toBe("idle");
  });
});

describe("FeedCache.updatePostEverywhere", () => {
  test("patches one post across tabs and notifies", () => {
    const cache = new FeedCache();
    cache.applyPage("a", [post("x")], null, {}, false);
    cache.applyPage("b", [post("x")], null, {}, false);
    let notifications = 0;
    const stop = cache.subscribe(() => {
      notifications += 1;
    });
    cache.updatePostEverywhere("x", { viewCount: 42 });
    expect(cache.get("a").pages[0]?.[0]?.viewCount).toBe(42);
    expect(cache.get("b").pages[0]?.[0]?.viewCount).toBe(42);
    expect(notifications).toBe(1);
    stop();
    cache.updatePostEverywhere("x", { viewCount: 43 });
    expect(notifications).toBe(1);
  });
});
