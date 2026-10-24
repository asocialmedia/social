import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { BoundedReadQueue } from "./read-queue";
import { SharedReadCache } from "./shared-read-cache";
import type { SharedReadStore } from "./shared-read-cache";

function memoryStore() {
  const entries = new Map<string, string>();
  const owners = new Map<string, string>();
  const store: SharedReadStore = {
    claim: (key, owner) => {
      if (owners.has(key)) {
        return Promise.resolve(false);
      }
      owners.set(key, owner);
      return Promise.resolve(true);
    },
    commit: (key, owner, value) => {
      if (owners.get(key) !== owner) {
        return Promise.resolve(false);
      }
      entries.set(key, value);
      owners.delete(key);
      return Promise.resolve(true);
    },
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    release: (key, owner) => {
      if (owners.get(key) === owner) {
        owners.delete(key);
      }
      return Promise.resolve();
    },
  };
  return { entries, owners, store };
}

const parse = (value: unknown) => {
  if (typeof value !== "string") {
    throw new TypeError("Invalid cached value");
  }
  return value;
};
const queue = () =>
  new BoundedReadQueue({ concurrency: 2, maxQueued: 8, maxWaitMs: 500 });

test("1000 identical readers share one request and cancellation of one reader preserves the others", async () => {
  const cache = new SharedReadCache({ parse, queue: queue(), ttlMs: 1000 });
  const upstream = Promise.withResolvers<string>();
  let calls = 0;
  const load = () => {
    calls += 1;
    return upstream.promise;
  };
  const controller = new AbortController();
  const cancelled = cache.read("query", load, controller.signal);
  const readers = Array.from({ length: 1000 }, () => cache.read("query", load));
  controller.abort();
  await expect(cancelled).rejects.toBeInstanceOf(Error);
  upstream.resolve("result");
  const values = await Promise.all(readers);
  expect(values.every((value) => value === "result")).toBe(true);
  expect(calls).toBe(1);
  expect(await cache.read("query", load)).toBe("result");
  expect(calls).toBe(1);
  expect(cache.stats.pending).toBe(0);
});

test("replicas use one shared lease and preserve the original freshness deadline", async () => {
  const { store, entries, owners } = memoryStore();
  const first = new SharedReadCache({
    parse,
    queue: queue(),
    store,
    ttlMs: 150,
  });
  const second = new SharedReadCache({
    parse,
    queue: queue(),
    store,
    ttlMs: 150,
  });
  let calls = 0;
  const load = async () => {
    calls += 1;
    await delay(20);
    return "shared";
  };
  const values = await Promise.all([
    first.read("query", load),
    second.read("query", load),
  ]);
  expect(values).toEqual(["shared", "shared"]);
  expect(calls).toBe(1);
  expect(owners.size).toBe(0);
  expect(entries.size).toBe(1);
  expect(second.stats.sharedHits).toBe(1);
  await delay(160);
  expect(await second.read("query", load)).toBe("shared");
  expect(calls).toBe(2);
});

test("failed reads do not poison the cache and a Redis outage falls back to bounded local work", async () => {
  const { store } = memoryStore();
  store.get = () => Promise.reject(new Error("offline"));
  const cache = new SharedReadCache({
    parse,
    queue: queue(),
    store,
    ttlMs: 1000,
  });
  await expect(
    cache.read("query", () => Promise.reject(new Error("upstream offline")))
  ).rejects.toThrow("upstream offline");
  expect(await cache.read("query", () => Promise.resolve("recovered"))).toBe(
    "recovered"
  );
  expect(cache.stats.pending).toBe(0);
});

test("expired and corrupt shared values are ignored and stale owners cannot publish locally", async () => {
  const { store, entries } = memoryStore();
  entries.set("corrupt", "not-json");
  entries.set("expired", JSON.stringify({ expiresAt: 1, value: "old" }));
  const cache = new SharedReadCache({
    parse,
    queue: queue(),
    store,
    ttlMs: 1000,
  });
  expect(await cache.read("corrupt", () => Promise.resolve("fresh"))).toBe(
    "fresh"
  );
  expect(await cache.read("expired", () => Promise.resolve("fresh"))).toBe(
    "fresh"
  );
  store.commit = () => Promise.resolve(false);
  let calls = 0;
  const load = () => {
    calls += 1;
    return Promise.resolve("fenced");
  };
  await cache.read("fenced", load);
  await cache.read("fenced", load);
  expect(calls).toBe(2);
});

test("stalled shared leases time out without starting duplicate upstream work", async () => {
  const { store, owners } = memoryStore();
  owners.set("query", "other-replica");
  const cache = new SharedReadCache({
    deadlineMs: 30,
    parse,
    queue: queue(),
    store,
    ttlMs: 1000,
  });
  let calls = 0;
  await expect(
    cache.read("query", () => {
      calls += 1;
      return Promise.resolve("unexpected");
    })
  ).rejects.toBeInstanceOf(Error);
  expect(calls).toBe(0);
  expect(cache.stats.pending).toBe(0);
});
