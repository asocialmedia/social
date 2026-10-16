import { describe, expect, test } from "bun:test";

import type { HnStory } from "./hackernews-api";
import { HnCache, HN_CACHE_RETENTION_MS, hnCacheKey } from "./hn-cache";
import type { HnPageResult } from "./hn-cache";

const key = hnCacheKey("https://example.test", "viewer", "score", "");

function story(id: number): HnStory {
  return {
    by: "ada",
    comments: 1,
    domain: null,
    id,
    score: id,
    time: 1,
    title: `Story ${id}`,
    url: null,
  };
}

function page(ids: number[], hasMore = false): HnPageResult {
  return {
    hasMore,
    page: 1,
    rateLimited: false,
    stories: ids.map(story),
  };
}

describe("HackerNews sort cache", () => {
  test("a warm tab reuses its pages without fetching again", async () => {
    const cache = new HnCache();
    let requests = 0;
    const fetchPage = () => {
      requests += 1;
      return Promise.resolve(page([1, 2]));
    };
    await cache.load(key, fetchPage);
    await cache.load(key, fetchPage);
    expect(requests).toBe(1);
    expect(cache.read(key).stories.map((row) => row.id)).toEqual([1, 2]);
  });

  test("coalesces concurrent loads of the same key", async () => {
    const cache = new HnCache();
    let requests = 0;
    const pending = Promise.withResolvers<HnPageResult>();
    const fetchPage = () => {
      requests += 1;
      return pending.promise;
    };
    const first = cache.load(key, fetchPage);
    const second = cache.load(key, fetchPage);
    expect(second).toBe(first);
    pending.resolve(page([1]));
    await first;
    expect(requests).toBe(1);
  });

  test("pagination appends unique rows and keeps the cursor", async () => {
    const cache = new HnCache();
    await cache.load(key, () =>
      Promise.resolve({ ...page([1, 2]), hasMore: true })
    );
    await cache.load(
      key,
      () => Promise.resolve({ ...page([2, 3]), hasMore: false }),
      "append"
    );
    expect(cache.read(key).stories.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(cache.read(key).hasMore).toBe(false);
  });

  test("a failed refresh keeps the visible rows and reports the error", async () => {
    const cache = new HnCache();
    await cache.load(key, () => Promise.resolve(page([1])));
    const visible = cache.read(key).stories;
    await cache.load(
      key,
      () => Promise.reject(new Error("offline")),
      "refresh"
    );
    expect(cache.read(key).stories).toBe(visible);
    expect(cache.read(key).error).toBe("offline");
    expect(cache.read(key).status).toBe("error");
  });

  test("a rate-limited page is recorded as a state, not an error", async () => {
    const cache = new HnCache();
    await cache.load(key, () =>
      Promise.resolve({
        hasMore: false,
        page: 1,
        rateLimited: true,
        stories: [],
      })
    );
    expect(cache.read(key).rateLimited).toBe(true);
    expect(cache.read(key).status).toBe("success");
  });

  test("an expired entry refetches while a fresh one does not", async () => {
    let now = 100;
    const cache = new HnCache(() => now);
    await cache.load(key, () => Promise.resolve(page([1])));
    expect(cache.isFresh(key)).toBe(true);
    now += HN_CACHE_RETENTION_MS + 1;
    expect(cache.isFresh(key)).toBe(false);
    let requests = 0;
    await cache.load(key, () => {
      requests += 1;
      return Promise.resolve(page([2]));
    });
    expect(requests).toBe(1);
    expect(cache.read(key).stories[0]?.id).toBe(2);
  });

  test("hydrates persisted rows and drops expired or corrupt data", async () => {
    const now = 1;
    const source = new HnCache(() => now);
    await source.load(key, () => Promise.resolve(page([1, 2])));
    const snapshot = source.snapshot();

    const restored = new HnCache(() => now);
    restored.hydrate(snapshot);
    expect(restored.read(key).stories.map((row) => row.id)).toEqual([1, 2]);

    const later = new HnCache(() => now + 8 * 24 * 60 * 60 * 1000);
    later.hydrate(snapshot);
    expect(later.read(key).stories).toEqual([]);
  });

  test("bookmark writes overlay the rows without dropping them", async () => {
    const cache = new HnCache();
    await cache.load(key, () => Promise.resolve(page([1, 2])));
    cache.setBookmarks(key, { 1: true });
    cache.setBookmark(key, 2, true);
    expect(cache.read(key).bookmarks).toEqual({ 1: true, 2: true });
    expect(cache.read(key).stories).toHaveLength(2);
  });

  test("clear retires in-flight loads and drops the snapshot", async () => {
    const cache = new HnCache();
    const pending = Promise.withResolvers<HnPageResult>();
    const request = cache.load(key, () => pending.promise);
    cache.clear();
    pending.resolve(page([9]));
    await request;
    expect(cache.read(key).stories).toEqual([]);
    expect(cache.snapshot().entries).toEqual({});
  });
});
