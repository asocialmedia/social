import { describe, expect, mock, test } from "bun:test";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import type Redis from "ioredis";

import { createCachedBlueskyClient } from "./cache-client";
import { inventoryPost } from "./discovery-fixtures";

describe("createCachedBlueskyClient", () => {
  test("a concurrent cold burst coalesces one read and feed options never collide", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: (key: string) => Promise.resolve(memory.get(key) ?? null),
      set: (key: string, value: string) => {
        memory.set(key, value);
        return Promise.resolve("OK");
      },
    } as unknown as Redis;
    const gate = Promise.withResolvers<undefined>();
    let calls = 0;
    const client = createCachedBlueskyClient(
      {
        getFeed: async () => {
          calls += 1;
          await gate.promise;
          return { cursor: null, items: [inventoryPost(calls)] };
        },
      } as unknown as BlueskyClient,
      redisMock
    );
    const uri = "at://did:plc:fixture/app.bsky.feed.generator/feed";
    const burst = Array.from({ length: 25 }, () =>
      client.getFeed(uri, { includePins: false, since: "2026-10-01T00:00:00Z" })
    );
    gate.resolve();
    await Promise.all(burst);
    expect(calls).toBe(1);
    await client.getFeed(uri, {
      includePins: true,
      since: "2026-10-01T00:00:00Z",
    });
    await client.getFeed(uri, {
      includePins: true,
      since: "2026-10-02T00:00:00Z",
    });
    expect(calls).toBe(3);
  });
  test("returns original client when redis is not provided", () => {
    const mockClient = {
      getPostThread: () => Promise.resolve(null),
    } as unknown as BlueskyClient;
    const client = createCachedBlueskyClient(mockClient);
    expect(client).toBe(mockClient);
  });

  test("caches getPostThread in redis and serves hits from cache", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    let targetCalls = 0;
    const mockClient = {
      getPostThread: mock((uri: string) => {
        targetCalls += 1;
        return Promise.resolve({
          post: { id: uri, source: "bluesky" },
          replies: [],
        });
      }),
    } as unknown as BlueskyClient;

    const cachedClient = createCachedBlueskyClient(mockClient, redisMock);

    const first = await cachedClient.getPostThread(
      "at://did:plc:alice/app.bsky.feed.post/123",
      3
    );
    expect(targetCalls).toBe(1);
    expect(first?.post?.id).toBe("at://did:plc:alice/app.bsky.feed.post/123");

    const second = await cachedClient.getPostThread(
      "at://did:plc:alice/app.bsky.feed.post/123",
      3
    );
    expect(targetCalls).toBe(1);
    expect(second?.post?.id).toBe("at://did:plc:alice/app.bsky.feed.post/123");
  });

  test("caches getProfile with 300s TTL and serves cache hits", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    let targetCalls = 0;
    const mockClient = {
      getProfile: mock((actor: string) => {
        targetCalls += 1;
        return Promise.resolve({
          displayName: "Alice",
          handle: actor,
        });
      }),
    } as unknown as BlueskyClient;

    const cachedClient = createCachedBlueskyClient(mockClient, redisMock);

    const profile1 = await cachedClient.getProfile("alice.bsky.social");
    expect(targetCalls).toBe(1);
    expect(profile1?.handle).toBe("alice.bsky.social");

    const profile2 = await cachedClient.getProfile("alice.bsky.social");
    expect(targetCalls).toBe(1);
    expect(profile2?.displayName).toBe("Alice");
  });

  test("caches getPosts and sorts URIs for canonical cache keying", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    let targetCalls = 0;
    const mockClient = {
      getPosts: mock((uris: string[]) => {
        targetCalls += 1;
        return Promise.resolve(uris.map((uri) => ({ id: uri })));
      }),
    } as unknown as BlueskyClient;

    const cachedClient = createCachedBlueskyClient(mockClient, redisMock);

    const result1 = await cachedClient.getPosts([
      "at://did:plc:2/app.bsky.feed.post/b",
      "at://did:plc:1/app.bsky.feed.post/a",
    ]);
    expect(targetCalls).toBe(1);
    expect(result1?.length).toBe(2);

    const result2 = await cachedClient.getPosts([
      "at://did:plc:1/app.bsky.feed.post/a",
      "at://did:plc:2/app.bsky.feed.post/b",
    ]);
    expect(targetCalls).toBe(1);
    expect(result2?.length).toBe(2);
  });

  test("handles Redis errors gracefully without interrupting reads", async () => {
    const redisMock = {
      get: mock(() => Promise.reject(new Error("Redis read timeout"))),
      set: mock(() => Promise.reject(new Error("Redis write failure"))),
    } as unknown as Redis;

    const mockClient = {
      getProfile: mock((actor: string) =>
        Promise.resolve({ displayName: "Bob", handle: actor })
      ),
    } as unknown as BlueskyClient;

    const cachedClient = createCachedBlueskyClient(mockClient, redisMock);
    const profile = await cachedClient.getProfile("bob.bsky.social");
    expect(profile?.displayName).toBe("Bob");
  });

  test("invalidate clears cache version so subsequent reads fetch fresh data", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    let targetCalls = 0;
    const mockClient = {
      getProfile: mock((actor: string) => {
        targetCalls += 1;
        return Promise.resolve({
          displayName: `Alice ${targetCalls}`,
          handle: actor,
        });
      }),
      invalidate: mock(() => {}),
    } as unknown as BlueskyClient;

    const cachedClient = createCachedBlueskyClient(mockClient, redisMock);

    const first = await cachedClient.getProfile("alice.bsky.social");
    expect(targetCalls).toBe(1);
    expect(first?.displayName).toBe("Alice 1");

    // Hit cache
    const second = await cachedClient.getProfile("alice.bsky.social");
    expect(targetCalls).toBe(1);
    expect(second?.displayName).toBe("Alice 1");

    // Invalidate
    cachedClient.invalidate?.();

    // Must fetch fresh data
    const third = await cachedClient.getProfile("alice.bsky.social");
    expect(targetCalls).toBe(2);
    expect(third?.displayName).toBe("Alice 2");
  });

  test("in-flight read does not write stale result if invalidation occurred during read", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    let targetCalls = 0;
    const { promise: readPending, resolve: finishRead } =
      Promise.withResolvers<boolean>();

    const mockClient = {
      getProfile: mock(async (actor: string) => {
        targetCalls += 1;
        await readPending;
        return {
          displayName: "Old Alice",
          handle: actor,
        };
      }),
      invalidate: mock(() => {}),
    } as unknown as BlueskyClient;

    const cachedClient = createCachedBlueskyClient(mockClient, redisMock);

    // Start read 1
    const readPromise = cachedClient.getProfile("alice.bsky.social");

    // While read 1 is in flight, an invalidation arrives
    cachedClient.invalidate?.();

    // Now let read 1 finish
    finishRead(true);
    const result1 = await readPromise;
    expect(result1?.displayName).toBe("Old Alice");

    // The stale result should NOT have been written to Redis for the new generation
    expect(memory.size).toBe(0);
  });

  test("shares visibility decisions across the cache, not just per call", async () => {
    const memory = new Map<string, string>();
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    let checks = 0;
    const mockClient = {
      allowsRecommendations: mock((did: string) => {
        checks += 1;
        return Promise.resolve(!did.endsWith("hidden"));
      }),
    } as unknown as BlueskyClient;

    // Two replicas, one Redis: the second must not repeat the upstream check.
    const first = createCachedBlueskyClient(mockClient, redisMock);
    const second = createCachedBlueskyClient(mockClient, redisMock);

    expect(await first.allowsRecommendations("did:plc:visible")).toBe(true);
    expect(await second.allowsRecommendations("did:plc:visible")).toBe(true);
    expect(checks).toBe(1);

    expect(await second.allowsRecommendations("did:plc:hidden")).toBe(false);
    expect(checks).toBe(2);
  });

  test("targeted invalidation keeps the shared namespace intact", async () => {
    const memory = new Map<string, string>();
    const written: string[] = [];
    const redisMock = {
      get: mock((key: string) => Promise.resolve(memory.get(key) ?? null)),
      set: mock((key: string, val: string, _mode: string, _ttl: number) => {
        memory.set(key, val);
        written.push(key);
        return Promise.resolve("OK");
      }),
    } as unknown as Redis;

    const checks = new Map<string, number>();
    const mockClient = {
      allowsRecommendations: mock((did: string) => {
        checks.set(did, (checks.get(did) ?? 0) + 1);
        return Promise.resolve(true);
      }),
      invalidate: mock(() => {}),
    } as unknown as BlueskyClient;

    const client = createCachedBlueskyClient(mockClient, redisMock);
    await client.allowsRecommendations("did:plc:alice");
    await client.allowsRecommendations("did:plc:bob");

    // One followed account changes; unrelated cached decisions must survive.
    client.invalidate("did:plc:alice");

    await client.allowsRecommendations("did:plc:bob");
    expect(checks.get("did:plc:bob")).toBe(1);

    await client.allowsRecommendations("did:plc:alice");
    expect(checks.get("did:plc:alice")).toBe(2);
  });
});

test("safe and adult-enabled clients never share cached post snapshots", async () => {
  const memory = new Map<string, string>();
  const store = {
    get: (key: string) => Promise.resolve(memory.get(key) ?? null),
    set: (key: string, value: string) => {
      memory.set(key, value);
      return Promise.resolve("OK");
    },
  } as unknown as Redis;
  const safe = createCachedBlueskyClient(
    {
      getPosts: () => Promise.resolve([inventoryPost(1)]),
    } as unknown as BlueskyClient,
    store
  );
  const adult = createCachedBlueskyClient(
    {
      getPosts: () =>
        Promise.resolve([{ ...inventoryPost(1), labels: ["porn"] }]),
    } as unknown as BlueskyClient,
    store,
    "asm:protocols:cache:explicit-v2"
  );
  const ids = [inventoryPost(1).id];
  const adultFirst = await adult.getPosts(ids);
  const safeFirst = await safe.getPosts(ids);
  const adultRepeat = await adult.getPosts(ids);
  expect(adultFirst[0]?.labels).toEqual(["porn"]);
  expect(safeFirst[0]?.labels).toEqual([]);
  expect(adultRepeat[0]?.labels).toEqual(["porn"]);
});
