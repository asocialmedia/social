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
