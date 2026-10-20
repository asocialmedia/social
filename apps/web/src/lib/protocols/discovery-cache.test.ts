import { beforeEach, expect, mock, test } from "bun:test";

let saved: string | null = null;
let unavailable = false;
const set = mock((_key: string, value: string) => {
  saved = value;
  return Promise.resolve("OK");
});
mock.module("@asm/db", () => ({
  redis: {
    get: () =>
      unavailable
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(saved),
    set,
  },
}));
const { cachedDiscoveryHead, discoveryCacheKey, saveDiscoveryHead } =
  await import("./discovery-cache");
beforeEach(() => {
  saved = null;
  unavailable = false;
  set.mockClear();
});
test("cache identity includes algorithm, language, and recommendation topics", () => {
  const key = discoveryCacheKey("latest", "en", []);
  expect(discoveryCacheKey("trending", "en", [])).not.toBe(key);
  expect(discoveryCacheKey("latest", "fr", [])).not.toBe(key);
  expect(discoveryCacheKey("latest", "en", ["science"])).not.toBe(key);
});
test("expired, malformed, or unavailable cache entries fall back to upstream", async () => {
  saved = JSON.stringify({
    at: Date.now() - 601_000,
    page: { cursor: null, items: [], partial: false },
  });
  expect(await cachedDiscoveryHead("key")).toBeNull();
  saved = "invalid json";
  expect(await cachedDiscoveryHead("key")).toBeNull();
  unavailable = true;
  expect(await cachedDiscoveryHead("key")).toBeNull();
});
test("an empty response cannot overwrite a usable cached head", async () => {
  await saveDiscoveryHead("key", { cursor: null, items: [], partial: true });
  expect(set).not.toHaveBeenCalled();
});
