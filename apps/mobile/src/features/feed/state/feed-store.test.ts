import { describe, expect, test } from "bun:test";

import type { FeedPost } from "../lib/feed-types";
import {
  FeedCache,
  reconcileFeedHead,
  feedFetchStatus,
  clearFeedTopRequest,
  consumeFeedTop,
  flattenUniquePosts,
  prependPosts,
  requestFeedTop,
  subscribeFeedTopRequests,
  persistFeedEntry,
  restoreFeedCache,
  feedCache,
  feedCacheToSnapshot,
} from "./feed-store";

function post(id: string): FeedPost {
  return {
    _count: { bookmarks: 0, comments: 0, responses: 0, vote: 0 },
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
  test("repeated head batches deduplicate within themselves and retain the pagination cursor", () => {
    const cache = new FeedCache();
    cache.applyPage("feed", [post("old")], "next-page", {}, false);
    const first = prependPosts(cache.get("feed").pages, [
      post("one"),
      post("one"),
    ]);
    cache.patch("feed", { pages: first.pages });
    const second = prependPosts(cache.get("feed").pages, [
      post("two"),
      post("one"),
    ]);
    cache.patch("feed", { pages: second.pages });
    expect(cache.get("feed").pages[0]?.map((item) => item.id)).toEqual([
      "two",
      "one",
      "old",
    ]);
    expect(cache.get("feed").cursor).toBe("next-page");
    expect(cache.get("feed").hasMore).toBe(true);
  });
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
  test("refresh, pagination and failed requests retain the last completed pages across relaunch", () => {
    for (const status of ["refreshing", "loading-more", "error"] as const) {
      feedCache.clear();
      feedCache.applyPage("saved", [post("retained")], "next-page", {}, false);
      const fetchedAt = Date.now() - 120_000;
      feedCache.patch("saved", { fetchedAt });
      feedCache.patch("saved", {
        error: status === "error" ? "Offline" : null,
        status,
      });
      const snapshot = feedCacheToSnapshot();
      expect(snapshot.saved?.pages[0]?.[0]?.id).toBe("retained");
      expect(snapshot.saved?.fetchedAt).toBe(fetchedAt);
      feedCache.clear();
      restoreFeedCache(snapshot);
      const restored = feedCache.get("saved");
      expect(restored.status).toBe("success");
      expect(restored.error).toBeNull();
      expect(restored.cursor).toBe("next-page");
      expect(restored.stale).toBe(true);
      expect(restored.pages[0]?.[0]?.id).toBe("retained");
    }
    feedCache.clear();
  });
  test("an interrupted refresh revalidates even when its completed pages are recent", () => {
    feedCache.clear();
    feedCache.applyPage("recent", [post("cached")], null, {}, false);
    feedCache.patch("recent", { status: "refreshing" });
    const snapshot = feedCacheToSnapshot();
    feedCache.clear();
    restoreFeedCache(snapshot);
    expect(feedCache.get("recent").stale).toBe(true);
    feedCache.clear();
  });
  test("disk truncation resumes at the saved page boundary without skipping posts", () => {
    const cache = new FeedCache();
    cache.applyPage("k", [post("a")], "page2", {}, false);
    cache.applyPage("k", [post("b")], "page3", {}, true);
    const final = cache.applyPage("k", [post("c")], null, {}, true);
    const saved = persistFeedEntry(final);
    expect(saved.pages).toHaveLength(2);
    expect(saved.cursor).toBe("page3");
    expect(saved.hasMore).toBe(true);
    feedCache.clear();
    restoreFeedCache({ k: saved });
    expect(feedCache.get("k").cursor).toBe("page3");
    expect(
      feedCache
        .get("k")
        .pages.flat()
        .map((entry) => entry.id)
    ).toEqual(["a", "b"]);
    feedCache.clear();
  });

  test("hydration preserves the original age and cannot overwrite a live request", () => {
    feedCache.clear();
    const fetchedAt = Date.now() - 120_000;
    const saved = {
      cursor: null,
      fetchedAt,
      hasMore: false,
      pageCursors: [null],
      pages: [[post("saved")]],
    };
    restoreFeedCache({ k: saved });
    expect(feedCache.get("k").fetchedAt).toBe(fetchedAt);
    expect(feedCache.get("k").stale).toBe(true);
    feedCache.patch("live", { status: "loading" });
    restoreFeedCache({ live: saved });
    expect(feedCache.get("live").status).toBe("loading");
    expect(feedCache.get("live").pages).toEqual([]);
    feedCache.clear();
  });

  test("legacy snapshots revalidate instead of trusting mismatched cursors", () => {
    feedCache.clear();
    restoreFeedCache({
      legacy: {
        cursor: "distant",
        fetchedAt: Date.now(),
        hasMore: true,
        pages: [[post("a")]],
      },
    });
    expect(feedCache.get("legacy").stale).toBe(true);
    feedCache.clear();
  });
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

  test("reports only the tabs that actually contain the post", () => {
    const cache = new FeedCache();
    cache.applyPage("a", [post("x")], null, {}, false);
    cache.applyPage("b", [post("y")], null, {}, false);
    const seen: (ReadonlySet<string> | null | undefined)[] = [];
    const stop = cache.subscribe((changedKeys) => {
      seen.push(changedKeys);
    });
    cache.updatePostEverywhere("x", { viewCount: 42 });
    expect(seen.length).toBe(1);
    expect(seen[0]?.has("a")).toBe(true);
    expect(seen[0]?.has("b")).toBe(false);
    stop();
  });

  test("scopes invalidation to its own tab", () => {
    const cache = new FeedCache();
    cache.applyPage("a", [post("x")], null, {}, false);
    const seen: (ReadonlySet<string> | null | undefined)[] = [];
    const stop = cache.subscribe((changedKeys) => {
      seen.push(changedKeys);
    });
    cache.invalidate("a");
    expect(seen).toEqual([new Set(["a"])]);
    stop();
  });
});

describe("FeedCache.showPublishedPost", () => {
  test("puts a published post at the head of a tab that already has pages", () => {
    const cache = new FeedCache();
    cache.applyPage(
      "latest:u1",
      [post("old1"), post("old2")],
      "cursor1",
      {},
      false
    );
    cache.showPublishedPost("latest:u1", post("fresh"));
    const entry = cache.get("latest:u1");
    expect(entry.pages[0]?.map((item) => item.id)).toEqual([
      "fresh",
      "old1",
      "old2",
    ]);
    // The cursor is untouched: the optimistic post is not a page boundary.
    expect(entry.cursor).toBe("cursor1");
    expect(entry.stale).toBe(false);
  });

  test("seeds a tab that was never fetched, marked stale so it refetches", () => {
    const cache = new FeedCache();
    cache.showPublishedPost("latest:u1", post("fresh"));
    const entry = cache.get("latest:u1");
    expect(entry.status).toBe("success");
    expect(entry.pages[0]?.map((item) => item.id)).toEqual(["fresh"]);
    // Stale is what makes the list refetch the real first page on mount; without
    // it the single optimistic post would BE the tab forever.
    expect(entry.stale).toBe(true);
  });

  test("never duplicates a post that is already cached", () => {
    const cache = new FeedCache();
    cache.applyPage("latest:u1", [post("a")], null, {}, false);
    cache.showPublishedPost("latest:u1", post("a"));
    expect(cache.get("latest:u1").pages[0]?.map((item) => item.id)).toEqual([
      "a",
    ]);
  });

  test("notifies subscribers so the list re-renders", () => {
    const cache = new FeedCache();
    let notifications = 0;
    cache.subscribe(() => {
      notifications += 1;
    });
    cache.showPublishedPost("latest:u1", post("fresh"));
    expect(notifications).toBe(1);
  });
});

describe("feed top request", () => {
  test("is claimed once, and only by the feed that asked for it", () => {
    requestFeedTop("latest");
    expect(consumeFeedTop("personalized")).toBe(false);
    expect(consumeFeedTop("latest")).toBe(true);
    expect(consumeFeedTop("latest")).toBe(false);
  });

  test("a later request replaces an unclaimed one", () => {
    requestFeedTop("latest");
    requestFeedTop("trending");
    expect(consumeFeedTop("latest")).toBe(false);
    expect(consumeFeedTop("trending")).toBe(true);
  });

  test("can be dropped so a stale request cannot hijack a later visit", () => {
    requestFeedTop("latest");
    clearFeedTopRequest();
    expect(consumeFeedTop("latest")).toBe(false);
  });

  test("notifies subscribers, so a feed already on screen can react", () => {
    // This is the case a tab switch cannot cover: publishing while already on
    // Latest changes none of that list's props, so without the subscription
    // the request would go unnoticed and linger.
    let notified = 0;
    const unsubscribe = subscribeFeedTopRequests(() => {
      notified += 1;
    });
    requestFeedTop("latest");
    unsubscribe();
    requestFeedTop("latest");
    expect(notified).toBe(1);
    clearFeedTopRequest();
  });
});

describe("FeedCache batched reconciliation", () => {
  test("one server batch notifies once and preserves unchanged pages and rows", () => {
    const cache = new FeedCache();
    cache.applyPage("latest", [post("a"), post("b")], "next", {}, false);
    cache.applyPage("latest", [post("c")], null, {}, true);
    cache.applyPage("trending", [post("a")], null, {}, false);
    cache.applyPage("following", [post("d")], null, {}, false);
    const before = cache.get("latest");
    const untouchedFeed = cache.get("following");
    const notifications: (ReadonlySet<string> | null | undefined)[] = [];
    cache.subscribe((keys) => {
      notifications.push(keys);
    });
    cache.updatePostsEverywhere(
      new Map([
        ["a", { viewCount: 42 }],
        ["b", { viewCount: 7 }],
      ])
    );
    expect(notifications).toEqual([new Set(["latest", "trending"])]);
    expect(cache.get("latest").pages[1]).toBe(before.pages[1]);
    expect(cache.get("following")).toBe(untouchedFeed);
    expect(cache.get("trending").pages[0]?.[0]?.viewCount).toBe(42);
    const after = cache.get("latest");
    cache.updatePostsEverywhere(
      new Map([
        ["a", { viewCount: 42 }],
        ["missing", { viewCount: 1 }],
      ])
    );
    expect(cache.get("latest")).toBe(after);
    expect(notifications).toHaveLength(1);
  });

  test("loading a neighbour only notifies its own feed", () => {
    const cache = new FeedCache();
    const seen: (ReadonlySet<string> | null | undefined)[] = [];
    cache.subscribe((keys) => {
      seen.push(keys);
    });
    cache.patch("trending", { status: "loading" });
    expect(seen).toEqual([new Set(["trending"])]);
    cache.invalidateAll();
    expect(seen[1]).toBe(null);
  });
});

test("next-day launch paints stale disk rows with their original age until refresh", () => {
  feedCache.clear();
  const fetchedAt = Date.now() - 24 * 60 * 60 * 1000;
  const saved = {
    cursor: null,
    fetchedAt,
    hasMore: false,
    pageCursors: [null],
    pages: [[post("yesterday")]],
  };
  expect(restoreFeedCache({ "latest:viewer": saved })).toBe(1);
  const entry = feedCache.get("latest:viewer");
  expect(entry.pages[0]?.[0]?.id).toBe("yesterday");
  expect(entry.fetchedAt).toBe(fetchedAt);
  expect(entry.stale).toBe(true);
  expect(
    restoreFeedCache({
      expired: { ...saved, fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
    })
  ).toBe(0);
  expect(
    restoreFeedCache({ future: { ...saved, fetchedAt: Date.now() + 60_000 } })
  ).toBe(0);
  feedCache.clear();
});

test("silent startup revalidation updates counts and retains deep feed history", () => {
  const old = post("old");
  const updated = { ...old, _count: { ...old._count, vote: 9 } };
  const cache = new FeedCache();
  cache.applyPage("feed", [old], "older-page", {}, false);
  cache.applyPage("feed", [post("deep")], "next-page", {}, true);
  cache.patch("feed", {
    pages: reconcileFeedHead(cache.get("feed").pages, [
      post("arrival"),
      updated,
    ]),
    status: "success",
  });
  expect(
    flattenUniquePosts(cache.get("feed").pages).map((item) => item.id)
  ).toEqual(["arrival", "old", "deep"]);
  expect(flattenUniquePosts(cache.get("feed").pages)[1]?._count?.vote).toBe(9);
  expect(cache.get("feed").cursor).toBe("next-page");
  expect(cache.get("feed").status).toBe("success");
});

test("only an explicit pull refresh drives the refresh indicator", () => {
  expect(feedFetchStatus("replace", true, false)).toBe("success");
  expect(feedFetchStatus("replace", true, true)).toBe("refreshing");
  expect(feedFetchStatus("replace", false, false)).toBe("loading");
  expect(feedFetchStatus("append", true, false)).toBe("loading-more");
});
