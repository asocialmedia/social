import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import type { JetstreamEvent } from "@asm/protocols/jetstream";

import { inventoryPost } from "./discovery-fixtures";
import { createDiscoveryIngestion } from "./discovery-ingestion";

const event = (
  index: number,
  operation: "create" | "update" | "delete" = "create"
): JetstreamEvent => ({
  commit: {
    collection: "app.bsky.feed.post",
    operation,
    record: { text: "TypeScript example" },
    rkey: "example",
  },
  did: `did:plc:inventory${index}`,
  kind: "commit",
  seq: index,
  time: new Date().toISOString(),
});

test("raw stream posts stay invisible until bounded hydration and author-policy checks succeed", async () => {
  const saved: ExternalPost[] = [];
  let reads = 0;
  let published = 0;
  const ingestion = createDiscoveryIngestion({
    client: {
      allowsRecommendations: (did) => Promise.resolve(!did.endsWith("1")),
      getPosts: () => {
        reads += 1;
        return Promise.resolve([inventoryPost(0), inventoryPost(1)]);
      },
      invalidate: () => {},
    },
    publish: () => {
      published += 1;
      return Promise.resolve();
    },
    store: {
      invalidate: () => Promise.resolve(),
      put: (posts) => {
        saved.push(...posts);
        return Promise.resolve();
      },
      read: () => Promise.resolve(saved),
    },
  });
  ingestion.watch(["TypeScript"]);
  await ingestion.event(event(0));
  await ingestion.event(event(1));
  expect(saved).toHaveLength(0);
  await Promise.all([ingestion.tick(), ingestion.tick()]);
  expect(reads).toBe(1);
  expect(saved.map((post) => post.id)).toEqual([inventoryPost(0).id]);
  expect(published).toBe(1);
});

test("unrelated records do not hydrate; deletes cancel queued creates; queue is bounded", async () => {
  let reads = 0;
  const invalidated: string[] = [];
  const ingestion = createDiscoveryIngestion({
    client: {
      allowsRecommendations: () => Promise.resolve(true),
      getPosts: () => {
        reads += 1;
        return Promise.resolve([]);
      },
      invalidate: () => {},
    },
    publish: () => Promise.resolve(),
    store: {
      invalidate: (target) => {
        invalidated.push(target);
        return Promise.resolve();
      },
      put: () => Promise.resolve(),
      read: () => Promise.resolve([]),
    },
  });
  ingestion.watch(["astronomy"]);
  await ingestion.event(event(0));
  await ingestion.tick();
  expect(reads).toBe(0);
  ingestion.watch(["TypeScript"]);
  await ingestion.event(event(0));
  await ingestion.event(event(0, "delete"));
  expect(ingestion.pendingCount).toBe(0);
  expect(invalidated).toContain(inventoryPost(0).id);
  await Promise.all(
    Array.from({ length: 150 }, (_, index) => ingestion.event(event(index)))
  );
  expect(ingestion.pendingCount).toBe(100);
});

test("matching posts displace general video traffic instead of starving niche interests", async () => {
  const reads: string[][] = [];
  const ingestion = createDiscoveryIngestion({
    client: {
      allowsRecommendations: () => Promise.resolve(true),
      getPosts: (ids) => {
        reads.push(ids);
        return Promise.resolve([]);
      },
      invalidate: () => {},
    },
    publish: () => Promise.resolve(),
    store: {
      invalidate: () => Promise.resolve(),
      put: () => Promise.resolve(),
      read: () => Promise.resolve([]),
    },
  });
  ingestion.watch([]);
  ingestion.watch(["TypeScript"]);
  await Promise.all(
    Array.from({ length: 100 }, (_, index) => {
      const item = event(index);
      if (item.kind === "commit") {
        item.commit.record = {
          embed: { $type: "app.bsky.embed.video" },
          text: "General clip",
        };
      }
      return ingestion.event(item);
    })
  );
  await ingestion.event(event(999));
  await ingestion.tick();
  expect(reads[0]?.[0]).toBe(inventoryPost(999).id);
  expect(reads[0]?.length).toBeLessThanOrEqual(6);
});

test.each([true, false, "unavailable"])(
  "ingestion dispatch %s preserves local fallback and raw-record isolation",
  async (dispatchResult) => {
    let localReads = 0;
    const dispatched: string[][] = [];
    const saved: ExternalPost[] = [];
    const ingestion = createDiscoveryIngestion({
      client: {
        allowsRecommendations: () => Promise.resolve(true),
        getPosts: () => {
          localReads += 1;
          return Promise.resolve([inventoryPost(0)]);
        },
        invalidate: () => {},
      },
      dispatch: (ids) => {
        dispatched.push(ids);
        return dispatchResult === "unavailable"
          ? Promise.reject(new Error("Queue unavailable"))
          : Promise.resolve(dispatchResult);
      },
      publish: () => Promise.resolve(),
      store: {
        invalidate: () => Promise.resolve(),
        put: (posts) => {
          saved.push(...posts);
          return Promise.resolve();
        },
        read: () => Promise.resolve([]),
      },
    });
    ingestion.watch(["TypeScript"]);
    await ingestion.event(event(0));
    await ingestion.tick();
    expect(dispatched).toEqual([[inventoryPost(0).id]]);
    expect(localReads).toBe(dispatchResult === true ? 0 : 1);
    expect(saved).toHaveLength(dispatchResult === true ? 0 : 1);
  }
);
