import { describe, expect, test } from "bun:test";

import { BoundedCache } from "./cache";

describe("bounded temporary protocol cache", () => {
  test("expires entries and makes room for fresh data", () => {
    let now = 0;
    const cache = new BoundedCache({
      maxBytes: 100,
      maxEntries: 2,
      now: () => now,
    });
    cache.set("a", "first", 10);
    cache.set("b", "second", 100);
    now = 11;
    expect(cache.get("a")).toBeNull();
    cache.set("c", "third", 100);
    expect(cache.get("b")).toBe("second");
    expect(cache.size).toBe(2);
  });

  test("evicts the least recently read entry when entry count is full", () => {
    const cache = new BoundedCache({ maxEntries: 2 });
    cache.set("a", "first", 1000);
    cache.set("b", "second", 1000);
    cache.get("a");
    cache.set("c", "third", 1000);
    expect(cache.get("a")).toBe("first");
    expect(cache.get("b")).toBeNull();
  });

  test("counts UTF-8 bytes, keys, replacement, and oversized entries", () => {
    const cache = new BoundedCache({ maxBytes: 10 });
    cache.set("a", "🦋", 1000);
    expect(cache.byteSize).toBe(5);
    cache.set("a", "b", 1000);
    expect(cache.byteSize).toBe(2);
    cache.set("large", "🦋🦋", 1000);
    expect(cache.get("large")).toBeNull();
    expect(cache.byteSize).toBe(2);
    cache.clear();
    expect(cache.byteSize).toBe(0);
    expect(cache.size).toBe(0);
  });

  test("selectively deletes matching keys and adjusts byte tracking", () => {
    const cache = new BoundedCache();
    cache.set("user:123:profile", "one", 1000);
    cache.set("user:456:profile", "two", 1000);
    cache.set("user:123:feed", "three", 1000);
    expect(cache.size).toBe(3);
    cache.deleteMatching((key) => key.includes("123"));
    expect(cache.size).toBe(1);
    expect(cache.get("user:123:profile")).toBeNull();
    expect(cache.get("user:123:feed")).toBeNull();
    expect(cache.get("user:456:profile")).toBe("two");
  });

  test("rejects unsafe limits and does not retain expired replacements", () => {
    expect(() => new BoundedCache({ maxEntries: 0 })).toThrow();
    expect(() => new BoundedCache({ maxBytes: Number.NaN })).toThrow();
    const cache = new BoundedCache();
    cache.set("a", "old", 1000);
    cache.set("a", "new", 0);
    expect(cache.get("a")).toBeNull();
  });
});
