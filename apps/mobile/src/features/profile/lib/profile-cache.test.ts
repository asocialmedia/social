import { describe, expect, test } from "bun:test";

import { BoundedProfileCache } from "./profile-cache";

describe("BoundedProfileCache", () => {
  test("keeps stale data and error state after a failed refresh", () => {
    let now = 1000;
    const cache = new BoundedProfileCache<string>({
      maxEntries: 2,
      now: () => now,
      staleMs: 100,
    });
    cache.setData("alice", "cached profile");
    now = 1101;
    expect(cache.isFresh("alice")).toBe(false);
    cache.markStale("alice");
    cache.setError("alice", "offline");
    expect(cache.read("alice")).toMatchObject({
      data: "cached profile",
      error: "offline",
      stale: true,
      status: "success",
    });
  });

  test("evicts the least-recently-used entry at capacity", () => {
    const cache = new BoundedProfileCache<string>({
      maxEntries: 2,
      now: () => 1,
      staleMs: 1000,
    });
    cache.setData("a", "A");
    cache.setData("b", "B");
    cache.read("a");
    cache.setData("c", "C");
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.size).toBe(2);
  });
});
