import { describe, expect, mock, test } from "bun:test";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import type Redis from "ioredis";

import { createCachedBlueskyClient } from "./cache-client";

describe("createCachedBlueskyClient", () => {
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
});
