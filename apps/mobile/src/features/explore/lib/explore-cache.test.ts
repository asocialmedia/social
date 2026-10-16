import { describe, expect, test } from "bun:test";

import { parseExplorePage } from "./explore-api";
import {
  ExploreCache,
  EXPLORE_RETENTION_MS,
  exploreCacheKey,
} from "./explore-cache";
import type { ExploreData } from "./explore-cache";

const key = exploreCacheKey("https://example.test", "viewer", "for-you", "");
function data(ids: string[], nextCursor: string | null = null): ExploreData {
  const page = parseExplorePage(
    {
      nextCursor,
      posts: ids.map((id) => ({
        attachments: [],
        content: id,
        id,
        userId: "author",
      })),
      users: [
        {
          _count: { followers: 3 },
          id: "author",
          isFollowing: false,
          username: "author",
        },
      ],
    },
    "posts"
  );
  return { ...page, gusts: page.posts.slice(0, 1) };
}
function deferred<T>() {
  return Promise.withResolvers<T>();
}

describe("Explore tab cache", () => {
  test("coalesces concurrent mounts and reuses a warm tab without fetching", async () => {
    const cache = new ExploreCache();
    const response = deferred<ExploreData>();
    let requests = 0;
    const fetchData = () => {
      requests += 1;
      return response.promise;
    };
    const first = cache.load(key, fetchData);
    const second = cache.load(key, fetchData);
    expect(second).toBe(first);
    response.resolve(data(["a"], "cursor"));
    await first;
    const cached = cache.read(key);
    await cache.load(key, fetchData);
    expect(requests).toBe(1);
    expect(cache.read(key)).toBe(cached);
  });

  test("pagination retains the rail, existing pages, people and scroll position", async () => {
    const cache = new ExploreCache();
    await cache.load(key, () => Promise.resolve(data(["a"], "next")));
    cache.setScrollOffset(key, 850);
    const page = { ...data(["a", "b"]), gusts: [], users: [] };
    await cache.load(key, () => Promise.resolve(page), "append", "next");
    expect(cache.read(key).data?.posts.map((post) => post.id)).toEqual([
      "a",
      "b",
    ]);
    expect(cache.read(key).data?.gusts.map((post) => post.id)).toEqual(["a"]);
    expect(cache.read(key).data?.users).toHaveLength(1);
    expect(cache.scrollOffset(key)).toBe(850);
    let requests = 0;
    await cache.load(
      key,
      () => {
        requests += 1;
        return Promise.resolve(page);
      },
      "append",
      "next"
    );
    expect(requests).toBe(0);
  });

  test("failed refresh preserves visible content, then retry replaces it", async () => {
    const cache = new ExploreCache();
    await cache.load(key, () => Promise.resolve(data(["a"])));
    const visible = cache.read(key).data;
    const request = cache.load(
      key,
      () => Promise.reject(new Error("offline")),
      "refresh"
    );
    expect(cache.read(key).data).toBe(visible);
    expect(cache.read(key).pending).toBe("refresh");
    await request;
    expect(cache.read(key).error).toBe("offline");
    expect(cache.read(key).data).toBe(visible);
    await cache.load(key, () => Promise.resolve(data(["new"])), "refresh");
    expect(cache.read(key).error).toBeNull();
    expect(cache.read(key).data?.posts[0]?.id).toBe("new");
  });

  test("late tab and query responses never overwrite the current query", async () => {
    const cache = new ExploreCache();
    const old = deferred<ExploreData>();
    const oldKey = exploreCacheKey(
      "https://example.test",
      "viewer",
      "people",
      "a"
    );
    const currentKey = exploreCacheKey(
      "https://example.test",
      "viewer",
      "people",
      "alice"
    );
    const pending = cache.load(oldKey, () => old.promise);
    await cache.load(currentKey, () => Promise.resolve(data(["alice"])));
    old.resolve(data(["old"]));
    await pending;
    expect(cache.read(currentKey).data?.posts[0]?.id).toBe("alice");
  });

  test("sign out rejects an in-flight account response and clears snapshots", async () => {
    const cache = new ExploreCache();
    const response = deferred<ExploreData>();
    const pending = cache.load(key, () => response.promise);
    cache.clear();
    response.resolve(data(["private"]));
    await pending;
    expect(cache.read(key).data).toBeNull();
    expect(cache.snapshot().entries).toEqual({});
  });

  test("follow updates affect every tab for only the current account and API", async () => {
    const cache = new ExploreCache();
    const people = exploreCacheKey(
      "https://example.test",
      "viewer",
      "people",
      ""
    );
    const other = exploreCacheKey(
      "https://example.test",
      "other",
      "people",
      ""
    );
    const otherApi = exploreCacheKey(
      "https://other.test",
      "viewer",
      "people",
      ""
    );
    await Promise.all(
      [key, people, other, otherApi].map((entry) =>
        cache.load(entry, () => data(["a"]))
      )
    );
    cache.updateFollow("https://example.test", "viewer", "author", {
      followers: 4,
      isFollowedByUser: true,
    });
    for (const entry of [key, people]) {
      expect(cache.read(entry).data?.users[0]?.isFollowing).toBe(true);
      expect(cache.read(entry).data?.users[0]?._count.followers).toBe(4);
    }
    for (const entry of [other, otherApi]) {
      expect(cache.read(entry).data?.users[0]?.isFollowing).toBe(false);
    }
  });

  test("hydrates fresh persisted pages without refetching, expires after retention", async () => {
    let now = 100;
    const source = new ExploreCache(() => now);
    await source.load(key, () => Promise.resolve(data(["a"], "next")));
    const cache = new ExploreCache(() => now);
    cache.hydrate(source.snapshot());
    let requests = 0;
    const fetchData = () => {
      requests += 1;
      return Promise.resolve(data(["b"]));
    };
    await cache.load(key, fetchData);
    expect(requests).toBe(0);
    expect(cache.read(key).data?.nextCursor).toBe("next");
    now += EXPLORE_RETENTION_MS;
    await cache.load(key, fetchData);
    expect(requests).toBe(1);
    expect(cache.read(key).data?.posts[0]?.id).toBe("b");
  });

  test("bounds stored searches and drops expired or corrupt persisted data", async () => {
    let now = 1;
    const cache = new ExploreCache(() => now);
    for (let index = 0; index < 20; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Sequential accesses pin cache eviction order.
      await cache.load(
        exploreCacheKey("api", "user", "people", String(index)),
        () => Promise.resolve(data(["a"]))
      );
    }
    expect(Object.keys(cache.snapshot().entries)).toHaveLength(16);
    const snapshot = cache.snapshot();
    now += EXPLORE_RETENTION_MS + 1;
    const restored = new ExploreCache(() => now);
    restored.hydrate(snapshot);
    expect(restored.snapshot().entries).toEqual({});
  });

  test("a repeated pagination cursor stops instead of fetching the same page forever", async () => {
    const cache = new ExploreCache();
    await cache.load(key, () => Promise.resolve(data(["a"], "same")));
    await cache.load(
      key,
      () => Promise.resolve(data(["a"], "same")),
      "append",
      "same"
    );
    expect(cache.read(key).data?.nextCursor).toBeNull();
  });
});
