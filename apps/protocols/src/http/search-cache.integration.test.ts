import { describe, expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  BoundedReadQueue,
  SharedReadCache,
  createRedisReadStore,
} from "@asm/protocols/discovery";
import Redis from "ioredis";

const redisUrl = process.env.PROTOCOLS_TEST_REDIS_URL ?? process.env.REDIS_URL;
describe.skipIf(!redisUrl)("shared search cache against Redis", () => {
  test("replicas coalesce reads and stale owners cannot publish or release another lease", async () => {
    const redis = new Redis(redisUrl ?? "", {
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
    });
    const store = createRedisReadStore(redis);
    const key = `asm:test:search:{${crypto.randomUUID()}}`;
    const leaseKey = `${key}:lease`;
    const resultKey = `${key}:result`;
    const makeCache = () =>
      new SharedReadCache({
        parse: (value) => {
          if (typeof value !== "string") {
            throw new TypeError("Invalid value");
          }
          return value;
        },
        queue: new BoundedReadQueue({
          concurrency: 2,
          maxQueued: 4,
          maxWaitMs: 500,
        }),
        store,
        ttlMs: 1000,
      });
    const first = makeCache();
    const second = makeCache();
    let calls = 0;
    try {
      const read = async () => {
        calls += 1;
        await delay(50);
        return "shared";
      };
      expect(
        await Promise.all([first.read(key, read), second.read(key, read)])
      ).toEqual(["shared", "shared"]);
      expect(calls).toBe(1);
      expect(await redis.pttl(resultKey)).toBeGreaterThan(0);
      expect(await redis.exists(leaseKey)).toBe(0);
      await redis.del(resultKey);
      expect(await store.claim(key, "old-owner", 20)).toBe(true);
      await delay(30);
      expect(await store.claim(key, "new-owner", 1000)).toBe(true);
      expect(await store.commit(key, "old-owner", "stale", 1000)).toBe(false);
      await store.release(key, "old-owner");
      expect(await redis.get(leaseKey)).toBe("new-owner");
      expect(await store.commit(key, "new-owner", "fresh", 1000)).toBe(true);
      expect(await redis.get(resultKey)).toBe("fresh");
    } finally {
      first.close();
      second.close();
      await redis.del(leaseKey, resultKey);
      redis.disconnect();
    }
  });
});
