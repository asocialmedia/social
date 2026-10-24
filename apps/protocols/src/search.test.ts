import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { BlueskyClient } from "@asm/protocols/bluesky";
import { createRedisReadStore } from "@asm/protocols/discovery";
import type { SharedReadStore } from "@asm/protocols/discovery";

import { createBlueskySearch } from "./search";

function client() {
  let calls = 0;
  const source = new BlueskyClient({
    fetch: () => {
      calls += 1;
      return Promise.resolve(Response.json({ actors: [], posts: [] }));
    },
  });
  return { calls: () => calls, source };
}

test("selected result types make one upstream call and result caches are isolated by media policy", async () => {
  const publicClient = client();
  const explicitClient = client();
  const search = createBlueskySearch({
    client: publicClient.source,
    explicitClient: explicitClient.source,
  });
  const { signal } = new AbortController();
  try {
    await search.read("software", 6, "user", false, signal);
    expect(publicClient.calls()).toBe(1);
    await search.read("software", 6, "all", false, signal);
    expect(publicClient.calls()).toBe(2);
    await search.read("software", 6, "user", true, signal);
    expect(explicitClient.calls()).toBe(1);
    expect(publicClient.calls()).toBe(2);
  } finally {
    search.close();
    publicClient.source.close();
    explicitClient.source.close();
  }
});

test("short bursts queue successfully and overload reports a retryable capacity error", async () => {
  const active = Promise.withResolvers<{ cursor: null; items: [] }>();
  const search = createBlueskySearch({
    client: { searchPosts: () => active.promise },
    concurrency: 1,
    maxQueued: 1,
    maxWaitMs: 200,
  });
  const { signal } = new AbortController();
  try {
    const first = search.read("first", 6, "post", false, signal);
    const second = search.read("second", 6, "post", false, signal);
    await expect(
      search.read("third", 6, "post", false, signal)
    ).rejects.toMatchObject({ code: "capacity", retryAfterSeconds: 1 });
    expect(search.stats()).toMatchObject({ active: 1, queued: 1 });
    active.resolve({ cursor: null, items: [] });
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.unavailable.length === 0)).toBe(
      true
    );
  } finally {
    search.close();
  }
});

test("deduplication across replicas avoids duplicate upstream reads", async () => {
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
  let calls = 0;
  const source = {
    searchActors: async () => {
      calls += 1;
      await delay(10);
      return [];
    },
  };
  const first = createBlueskySearch({ client: source, store });
  const second = createBlueskySearch({ client: source, store });
  try {
    await Promise.all(
      [first, second].map((search) =>
        search.read("same", 6, "user", false, new AbortController().signal)
      )
    );
    expect(calls).toBe(1);
  } finally {
    first.close();
    second.close();
  }
});

test("Redis store uses expiring leases and fenced publication in the same cluster slot", async () => {
  const calls: (string | number)[][] = [];
  const store = createRedisReadStore({
    eval: (...args) => {
      calls.push(args);
      return Promise.resolve(1);
    },
    get: () => Promise.resolve(null),
    set: (...args) => {
      calls.push(args);
      return Promise.resolve("OK");
    },
  });
  const key = "search:{digest}";
  expect(await store.claim(key, "owner", 6500)).toBe(true);
  expect(await store.commit(key, "owner", "value", 1000)).toBe(true);
  await store.release(key, "owner");
  expect(calls[0]).toEqual([
    "search:{digest}:lease",
    "owner",
    "PX",
    6500,
    "NX",
  ]);
  expect(calls[1]?.slice(1, 4)).toEqual([
    2,
    "search:{digest}:lease",
    "search:{digest}:result",
  ]);
  expect(calls[1]?.[0]).toContain("ARGV[1]");
});
