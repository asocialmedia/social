import { expect, test } from "bun:test";
import { once } from "node:events";

import { parseJetstreamEvent } from "@asm/protocols/jetstream";
import Redis from "ioredis";

import { RedisCheckpointStore } from "./checkpoints";

const redisUrl = process.env.PROTOCOLS_TEST_REDIS_URL;

test.skipIf(!redisUrl)(
  "Redis ownership fences stale workers and checkpoints never move backwards",
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
    const did = `did:web:protocols-test-${crypto.randomUUID()}.invalid`;
    const options = { dids: [did] };
    const first = new RedisCheckpointStore(redis, {
      ...options,
      owner: "first",
    });
    const second = new RedisCheckpointStore(redis, {
      ...options,
      owner: "second",
    });
    const event = (seq: number) =>
      parseJetstreamEvent(
        JSON.stringify({
          commit: {
            collection: "app.bsky.feed.post",
            operation: "delete",
            rkey: "example",
          },
          did,
          kind: "commit",
          seq,
          time: "2026-10-16T10:00:00.000Z",
        })
      );
    try {
      await redis.connect();
      expect(await first.acquire()).toBe(true);
      expect(await second.acquire()).toBe(false);
      await first.commit(event(101));
      expect(await first.load()).toBe(101);
      await expect(second.commit(event(102))).rejects.toThrow("lease");
      await second.release();
      expect(await first.renew()).toBe(true);
      await first.release();
      expect(await second.acquire()).toBe(true);
      await expect(first.commit(event(103))).rejects.toThrow("lease");
      await first.release();
      expect(await second.renew()).toBe(true);
      await second.commit(event(102));
      await second.commit(event(101));
      expect(await second.load()).toBe(102);
    } finally {
      await redis
        .del(`${first.scope}:lease`, `${first.scope}:cursor`)
        .catch(() => {});
      redis.disconnect();
    }
  }
);

test.skipIf(!redisUrl)(
  "batched checkpoints advance once while publishing every invalidation",
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
    const did = `did:web:protocols-batch-${crypto.randomUUID()}.invalid`;
    const options = { dids: [did] };
    const store = new RedisCheckpointStore(redis, {
      ...options,
      owner: "batch",
    });
    const event = (seq: number) =>
      parseJetstreamEvent(
        JSON.stringify({
          commit: {
            collection: "app.bsky.feed.post",
            operation: "delete",
            rkey: `example-${seq}`,
          },
          did,
          kind: "commit",
          seq,
          time: "2026-10-16T10:00:00.000Z",
        })
      );
    const subscriber = new Redis(redisUrl, {
      commandTimeout: 3000,
      connectTimeout: 3000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    const published: string[] = [];
    try {
      await redis.connect();
      await subscriber.connect();
      await subscriber.subscribe("asm:protocols:invalidations");
      subscriber.on("message", (_channel, message) => {
        published.push(message);
      });
      expect(await store.acquire()).toBe(true);
      const received = [
        once(subscriber, "message"),
        once(subscriber, "message"),
        once(subscriber, "message"),
      ];
      await store.commitBatch([event(11), event(12), event(13)]);
      expect(await store.load()).toBe(13);
      // Listeners attach before the commit, so nothing published afterwards
      // can slip through before the wait starts.
      await Promise.all(received);
      expect(published).toHaveLength(3);
      expect(published.map((raw) => JSON.parse(raw).seq)).toEqual([11, 12, 13]);
    } finally {
      await subscriber.disconnect();
      await redis
        .del(`${store.scope}:lease`, `${store.scope}:cursor`)
        .catch(() => {});
      redis.disconnect();
    }
  }
);
