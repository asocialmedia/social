// Queue recovery is asynchronous; deadlines bound each wait without stopping the workers' event loop.
// oxlint-disable no-await-in-loop
import { expect, test } from "bun:test";

import Redis from "ioredis";

import { inventoryPost } from "./discovery-fixtures";
import { hydrateDiscoveryBatch } from "./discovery-ingestion";
import { RedisInventoryStore } from "./discovery-inventory-store";
import { createIngestionQueue } from "./ingestion-queue";

const redisUrl = process.env.PROTOCOLS_TEST_REDIS_URL;
const id = "at://did:plc:alice/app.bsky.feed.post/example";
const logger = { debug() {}, error() {}, info() {}, warn() {} };
async function until(condition: () => boolean, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Queue test deadline exceeded");
    }
    await Bun.sleep(25);
  }
}

test.skipIf(!redisUrl)(
  "shared ingestion batches run remotely and node removal returns work to the local consumer",
  async () => {
    if (!redisUrl) {
      return;
    }
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const scope = `protocol-hydration-test-${crypto.randomUUID()}`;
    const nodes = ["remote"];
    const primary = createIngestionQueue({
      allowedNodes: nodes,
      coordinator: true,
      hydrate: () => Promise.resolve(1),
      logger,
      node: "local",
      redis,
      redisUrl,
      scope,
    });
    const remote = createIngestionQueue({
      coordinator: false,
      hydrate: () => Promise.resolve(1),
      logger,
      node: "remote",
      redis,
      redisUrl,
      scope,
    });
    try {
      await primary.worker.waitUntilReady();
      await primary.refresh();
      await primary.worker.pause();
      await remote.refresh();
      expect(remote.status().permitted).toBe(true);
      expect(await primary.enqueue([id], Date.now())).toBe(true);
      await until(() => remote.status().completed === 1);
      nodes.splice(0);
      await primary.refresh();
      await remote.refresh();
      expect(remote.status().permitted).toBe(false);
      expect(await primary.enqueue([id], Date.now())).toBe(true);
      await until(() => primary.status().completed === 1);
      expect(remote.status().completed).toBe(1);
      nodes.push("remote");
      await primary.refresh();
      await primary.worker.pause();
      await remote.refresh();
      expect(remote.status().permitted).toBe(true);
      expect(await primary.enqueue([id], Date.now())).toBe(true);
      await until(() => remote.status().completed === 2);
      await redis.del(`${scope}:workers`);
      await remote.refresh();
      expect(remote.status().permitted).toBe(false);
    } finally {
      await remote.worker.close(true);
      await primary.worker.close(true);
      await primary.queue.obliterate({ force: true });
      await remote.close();
      await primary.close();
      await redis.del(`${scope}:workers`);
      redis.disconnect();
    }
  },
  15_000
);

test.skipIf(!redisUrl)(
  "remote hydration writes shared policy-checked inventory and cannot undo a newer deletion",
  async () => {
    if (!redisUrl) {
      return;
    }
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    await redis.ping();
    const scope = `protocol-hydration-inventory-${crypto.randomUUID()}`;
    const inventoryScope = `${scope}:inventory`;
    const store = new RedisInventoryStore(redis, inventoryScope);
    let published = 0;
    const remote = createIngestionQueue({
      coordinator: false,
      hydrate: (ids, startedAt) =>
        hydrateDiscoveryBatch(
          {
            client: {
              allowsRecommendations: (did) =>
                Promise.resolve(!did.endsWith("1")),
              getPosts: () =>
                Promise.resolve([inventoryPost(0), inventoryPost(1)]),
            },
            publish: () => {
              published += 1;
              return Promise.resolve();
            },
            store,
          },
          ids,
          startedAt
        ),
      logger,
      node: "remote",
      redis,
      redisUrl,
      scope,
    });
    try {
      await remote.refresh();
      expect(remote.status().permitted).toBe(false);
      await redis.set(`${scope}:workers`, JSON.stringify(["remote"]), "EX", 30);
      await remote.refresh();
      expect(await remote.enqueue([inventoryPost(0).id], Date.now())).toBe(
        true
      );
      await until(() => remote.status().completed === 1);
      const reader = new RedisInventoryStore(redis, inventoryScope);
      const posts = await reader.read();
      expect(posts.map((post) => post.id)).toEqual([inventoryPost(0).id]);
      expect(published).toBe(1);
      const startedAt = Date.now();
      await store.invalidate(inventoryPost(0).id);
      await remote.enqueue([inventoryPost(0).id], startedAt);
      await until(() => remote.status().completed === 2);
      expect(await reader.read()).toEqual([]);
      await redis.set(`${scope}:workers`, "invalid");
      await remote.refresh();
      expect(remote.status().permitted).toBe(false);
    } finally {
      await remote.worker.close(true);
      await remote.queue.obliterate({ force: true });
      await remote.close();
      const keys = await redis.keys(`${scope}:*`);
      if (keys.length) {
        await redis.del(...keys);
      }
      redis.disconnect();
    }
  },
  15_000
);

test.skipIf(!redisUrl)(
  "a disappeared remote consumer has its unfinished batch reclaimed locally",
  async () => {
    if (!redisUrl) {
      return;
    }
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const scope = `protocol-hydration-recovery-${crypto.randomUUID()}`;
    const claimed = Promise.withResolvers<undefined>();
    const blocked = Promise.withResolvers<number>();
    const primary = createIngestionQueue({
      allowedNodes: ["remote"],
      coordinator: true,
      hydrate: () => Promise.resolve(1),
      lockDuration: 1000,
      logger,
      node: "local",
      redis,
      redisUrl,
      scope,
      stalledInterval: 250,
    });
    const remote = createIngestionQueue({
      coordinator: false,
      hydrate: () => {
        claimed.resolve();
        return blocked.promise;
      },
      lockDuration: 1000,
      logger,
      node: "remote",
      redis,
      redisUrl,
      scope,
      stalledInterval: 250,
    });
    try {
      await primary.worker.waitUntilReady();
      await primary.refresh();
      await primary.worker.pause();
      await remote.refresh();
      await primary.enqueue([id], Date.now());
      await Promise.race([
        claimed.promise,
        Bun.sleep(5000).then(() => {
          throw new Error("Remote did not claim work");
        }),
      ]);
      await redis.del(`${scope}:workers`);
      const draining = remote.refresh();
      await Bun.sleep(25);
      await remote.close();
      await primary.worker.resume();
      await until(() => primary.status().completed === 1);
      expect(primary.status().completed).toBe(1);
      blocked.resolve(0);
      await draining;
    } finally {
      blocked.resolve(0);
      await remote.worker.close(true);
      await primary.worker.close(true);
      await primary.queue.obliterate({ force: true });
      await remote.close();
      await primary.close();
      await redis.del(`${scope}:workers`);
      redis.disconnect();
    }
  },
  15_000
);
