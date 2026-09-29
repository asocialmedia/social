import { describe, expect, test } from "bun:test";

import { createViewerScanCache } from "./viewer-scan-cache";

describe("viewer scan cache", () => {
  test("marks and reports scanned ids", () => {
    const cache = createViewerScanCache();
    expect(cache.has("a")).toBe(false);
    cache.mark("a");
    expect(cache.has("a")).toBe(true);
    expect(cache.size()).toBe(1);
  });

  test("delete forgets a verdict so a retry can re-scan", () => {
    const cache = createViewerScanCache();
    cache.mark("a");
    cache.delete("a");
    expect(cache.has("a")).toBe(false);
  });

  test("clear empties the set", () => {
    const cache = createViewerScanCache();
    cache.mark("a");
    cache.mark("b");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.has("a")).toBe(false);
  });

  test("evicts the oldest entry past the cap", () => {
    const cache = createViewerScanCache(2);
    cache.mark("a");
    cache.mark("b");
    cache.mark("c");
    expect(cache.size()).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  test("re-marking refreshes recency so a hot id survives eviction", () => {
    const cache = createViewerScanCache(2);
    cache.mark("a");
    cache.mark("b");
    // Touch "a" so it becomes most-recently-used, then overflow with "c".
    cache.mark("a");
    cache.mark("c");
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  test("never exceeds the cap under sustained marks", () => {
    const cache = createViewerScanCache(32);
    for (let index = 0; index < 1000; index += 1) {
      cache.mark(`id-${index}`);
    }
    expect(cache.size()).toBe(32);
  });
});
