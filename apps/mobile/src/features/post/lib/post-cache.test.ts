import { describe, expect, test } from "bun:test";

import { FeedApiError } from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";

import { PostDetailCache, postDetailKey } from "./post-cache";

const post: FeedPost = {
  content: "Real cached content",
  createdAt: "2026-10-08",
  id: "post",
  userId: "author",
};

describe("post detail cache", () => {
  test("touch prefetch and navigation share a single request", async () => {
    const cache = new PostDetailCache();
    cache.seed("key", post);
    expect(cache.read("key")?.post).toBe(post);
    let requests = 0;
    const loader = () => {
      requests += 1;
      return Promise.resolve({ ancestors: [post], post });
    };
    const first = cache.load("key", loader);
    const second = cache.load("key", loader);
    expect(first).toBe(second);
    await first;
    expect(requests).toBe(1);
    expect(cache.read("key")?.ancestors).toEqual([post]);
  });

  test("account and API changes cannot read another viewer's cached detail", () => {
    const cache = new PostDetailCache();
    cache.seed(postDetailKey("post", "a", "https://one"), post);
    expect(
      cache.read(postDetailKey("post", "b", "https://one"))
    ).toBeUndefined();
    expect(
      cache.read(postDetailKey("post", "a", "https://two"))
    ).toBeUndefined();
    expect(
      cache.read(postDetailKey("post", undefined, "https://one"))
    ).toBeUndefined();
  });

  test("network failures retain previews, access denial evicts them and retries work", async () => {
    const cache = new PostDetailCache();
    cache.seed("key", post);
    await expect(
      cache.load("key", () => {
        throw new Error("offline");
      })
    ).rejects.toThrow("offline");
    expect(cache.read("key")?.post).toBe(post);
    await expect(
      cache.load("key", () => {
        throw new FeedApiError("private", 404);
      })
    ).rejects.toThrow("private");
    expect(cache.read("key")).toBeUndefined();
    await cache.load("key", () => Promise.resolve({ ancestors: [], post }));
    expect(cache.read("key")?.post).toBe(post);
  });

  test("retains recently used entries while bounding memory", () => {
    const cache = new PostDetailCache();
    for (let index = 0; index < 32; index += 1) {
      cache.seed(String(index), post);
    }
    cache.read("0");
    cache.seed("32", post);
    expect(cache.read("0")).toBeDefined();
    expect(cache.read("1")).toBeUndefined();
    expect(cache.read("32")).toBeDefined();
  });
});

test("cold-start detail restoration retains freshness, scope and live updates", () => {
  let now = 1000;
  const before = new PostDetailCache(() => now);
  const key = postDetailKey("post", "a", "https://one");
  before.seed(key, post);
  const snapshot = before.snapshot();
  now += 100;
  const after = new PostDetailCache(() => now);
  after.restore(snapshot);
  expect(after.read(key)?.post).toEqual(post);
  expect(after.read(postDetailKey("post", "b", "https://one"))).toBeUndefined();
  expect(after.snapshot().entries[key]?.fetchedAt).toBe(1000);
  const live = new PostDetailCache(() => now);
  live.seed(key, { ...post, content: "Updated" });
  live.restore(snapshot);
  expect(live.read(key)?.post.content).toBe("Updated");
  now += 31 * 60 * 1000;
  expect(after.read(key)).toBeUndefined();
  const expired = new PostDetailCache(() => now);
  expired.restore(snapshot);
  expect(expired.read(key)).toBeUndefined();
});

test("corrupt, future and oversized detail snapshots cannot enter the launch cache", () => {
  const before = new PostDetailCache(() => 1000);
  before.seed("key", post);
  const snapshot = before.snapshot();
  const future = new PostDetailCache(() => 500);
  future.restore(snapshot);
  expect(future.read("key")).toBeUndefined();
  snapshot.entries["key"] = {
    data: { ancestors: [], post: { ...post, id: null } as unknown as FeedPost },
    fetchedAt: 1000,
  };
  const after = new PostDetailCache(() => 1000);
  after.restore(snapshot);
  expect(after.read("key")).toBeUndefined();
  for (let index = 0; index < 40; index += 1) {
    snapshot.entries[String(index)] = {
      data: { ancestors: [], post },
      fetchedAt: 1000,
    };
  }
  after.restore(snapshot);
  expect(Object.keys(after.snapshot().entries)).toHaveLength(32);
});
