import { expect, test } from "bun:test";

import Redis from "ioredis";

import { RedisDiscoveryStore, discoveryStoreCapacity } from "./discovery-store";

const redisUrl = process.env.PROTOCOLS_TEST_REDIS_URL;

test.skipIf(!redisUrl)(
  "production discovery capacity preserves an early continuation beyond 512 cached pages",
  async () => {
    if (!redisUrl) {
      return;
    }
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const scope = `asm:protocols:{capacity-test-${crypto.randomUUID()}}`;
    const store = new RedisDiscoveryStore(redis, {
      ...discoveryStoreCapacity,
      scope,
    });
    try {
      await store.set("early-cursor", "retained-continuation", 60_000);
      await Promise.all(
        Array.from({ length: 1000 }, (_, index) =>
          store.set(`page-${index}`, "validated-source-page", 60_000)
        )
      );
      expect(await store.get("early-cursor")).toBe("retained-continuation");
      expect(await redis.hlen(`${scope}:data`)).toBe(1001);
      expect(Number(await redis.get(`${scope}:bytes`))).toBeLessThanOrEqual(
        discoveryStoreCapacity.maxBytes
      );
    } finally {
      await redis.del(
        ...["data", "sizes", "expiry", "lru", "bytes"].map(
          (suffix) => `${scope}:${suffix}`
        )
      );
      redis.disconnect();
    }
  }
);

test.skipIf(!redisUrl)(
  "Redis discovery bounds storage, expires data, and fences stale refreshes",
  async () => {
    if (!redisUrl) {
      return;
    }
    const redis = new Redis(redisUrl, {
      commandTimeout: 3000,
      connectTimeout: 3000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    const scope = `asm:protocols:{test-${crypto.randomUUID()}}`;
    const first = new RedisDiscoveryStore(redis, {
      maxBytes: 100,
      maxEntries: 2,
      scope,
    });
    const second = new RedisDiscoveryStore(redis, {
      maxBytes: 100,
      maxEntries: 2,
      scope,
    });
    const keys = [
      "data",
      "sizes",
      "expiry",
      "lru",
      "bytes",
      "lock:refresh",
    ].map((suffix) => `${scope}:${suffix}`);
    try {
      await redis.connect();
      expect(await first.acquire("refresh", "first")).toBe(true);
      expect(await second.acquire("refresh", "second")).toBe(false);
      expect(
        await first.set("page", "one", 1000, { key: "refresh", owner: "first" })
      ).toBe(true);
      expect(await second.get("page")).toBe("one");
      await second.release("refresh", "second");
      expect(await second.acquire("refresh", "second")).toBe(false);
      await redis.pexpire(`${scope}:lock:refresh`, 1);
      await Bun.sleep(10);
      expect(await second.acquire("refresh", "second")).toBe(true);
      expect(
        await first.set("page", "stale", 1000, {
          key: "refresh",
          owner: "first",
        })
      ).toBe(false);
      await first.release("refresh", "first");
      expect(
        await second.set("page", "two", 1000, {
          key: "refresh",
          owner: "second",
        })
      ).toBe(true);
      expect(await first.get("page")).toBe("two");
      expect(await first.set("large", "x".repeat(101), 1000)).toBe(false);
      expect(await first.get("page")).toBe("two");
      expect(await first.set("second", "y".repeat(50), 1000)).toBe(true);
      expect(await first.set("third", "z".repeat(50), 1000)).toBe(true);
      expect(await redis.hlen(`${scope}:data`)).toBeLessThanOrEqual(2);
      expect(Number(await redis.get(`${scope}:bytes`))).toBeLessThanOrEqual(
        100
      );
      expect(await first.get("third")).toBe("z".repeat(50));
      expect(await first.set("expires", "temporary", 1)).toBe(true);
      await Bun.sleep(10);
      expect(await second.get("expires")).toBeNull();
      expect(await redis.hget(`${scope}:sizes`, "expires")).toBeNull();
    } finally {
      await redis.del(...keys).catch(() => {});
      redis.disconnect();
    }
  }
);
