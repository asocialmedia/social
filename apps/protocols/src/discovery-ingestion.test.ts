import { expect, mock, test } from "bun:test";

import { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import type { ExternalPost } from "@asm/protocols/contracts";
import type { JetstreamEvent } from "@asm/protocols/jetstream";

import { inventoryPost } from "./discovery-fixtures";
import {
  createDiscoveryIngestion,
  createHydrationReader,
  hydrateDiscoveryBatch,
} from "./discovery-ingestion";
import { runHydrationJob } from "./ingestion-queue";

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

test.each([false, "queue-error"])(
  "local fallback %s retains transient failures until cooldown ends with the original fence",
  async (dispatch) => {
    let now = 10_000;
    let reads = 0;
    const put = mock(() => Promise.resolve());
    const ingestion = createDiscoveryIngestion({
      client: {
        allowsRecommendations: () =>
          reads === 1
            ? Promise.reject(new ProtocolError("unavailable", "Cooldown", 5))
            : Promise.resolve(true),
        getPosts: () => {
          reads += 1;
          return Promise.resolve([inventoryPost(0)]);
        },
        invalidate() {},
      },
      dispatch: () =>
        dispatch === "queue-error"
          ? Promise.reject(new Error("Queue unavailable"))
          : Promise.resolve(false),
      now: () => now,
      publish: () => Promise.resolve(),
      store: {
        invalidate: () => Promise.resolve(),
        put,
        read: () => Promise.resolve([]),
      },
    });
    ingestion.watch(["TypeScript"]);
    await ingestion.event(event(0));
    await ingestion.tick();
    expect(ingestion.pendingCount).toBe(1);
    expect(put).not.toHaveBeenCalled();
    now = 14_999;
    await ingestion.tick();
    expect(reads).toBe(1);
    now = 15_000;
    await ingestion.tick();
    expect(put).toHaveBeenCalledWith(
      [expect.objectContaining({ id: inventoryPost(0).id })],
      10_000
    );
    expect(ingestion.pendingCount).toBe(0);
  }
);

test("local retries stop after three failures and deletion removes deferred candidates", async () => {
  let now = 10_000;
  const getPosts = mock(() =>
    Promise.reject(new ProtocolError("unavailable", "Retry", 1))
  );
  const put = mock(() => Promise.resolve());
  const ingestion = createDiscoveryIngestion({
    client: {
      allowsRecommendations: () => Promise.resolve(true),
      getPosts,
      invalidate() {},
    },
    now: () => now,
    publish: () => Promise.resolve(),
    store: {
      invalidate: () => Promise.resolve(),
      put,
      read: () => Promise.resolve([]),
    },
  });
  ingestion.watch(["TypeScript"]);
  await ingestion.event(event(0));
  await ingestion.tick();
  now += 1000;
  await ingestion.tick();
  now += 1000;
  await ingestion.tick();
  expect(ingestion.pendingCount).toBe(0);
  expect(getPosts).toHaveBeenCalledTimes(3);
  await ingestion.event(event(1));
  await ingestion.tick();
  expect(ingestion.pendingCount).toBe(1);
  await ingestion.event(event(1, "delete"));
  now += 1000;
  await ingestion.tick();
  expect(ingestion.pendingCount).toBe(0);
  expect(getPosts).toHaveBeenCalledTimes(4);
  expect(put).not.toHaveBeenCalled();
});

test.each(["capacity", "unavailable", "rate_limited"] as const)(
  "permission read %s fails the job before inventory writes and permits a complete retry",
  async (code) => {
    const posts = [inventoryPost(0), inventoryPost(1), inventoryPost(2)];
    const error = new ProtocolError(code, "Temporary permission failure");
    let fail = true;
    const put = mock(() => Promise.resolve());
    const publish = mock(() => Promise.resolve());
    const hydrate = (ids: string[], startedAt: number) =>
      hydrateDiscoveryBatch(
        {
          client: {
            allowsRecommendations: (did) => {
              if (fail && did === posts[2]?.author.id) {
                return Promise.reject(error);
              }
              return Promise.resolve(did !== posts[1]?.author.id);
            },
            getPosts: () => Promise.resolve(posts),
          },
          publish,
          store: {
            invalidate: () => Promise.resolve(),
            put,
            read: () => Promise.resolve([]),
          },
        },
        ids,
        startedAt
      );
    const batch = { ids: posts.map((post) => post.id), startedAt: 10_000 };
    await expect(runHydrationJob(batch, hydrate, () => 10_000)).rejects.toBe(
      error
    );
    expect(put).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    fail = false;
    expect(await runHydrationJob(batch, hydrate, () => 10_000)).toBe(2);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith([posts[0], posts[2]], batch.startedAt);
    expect(publish).toHaveBeenCalledTimes(1);
  }
);

test("overlapping hydration jobs retry capacity failures instead of completing with omitted authors", async () => {
  const saturated = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let reads = 0;
  const client = new BlueskyClient({
    fetch: async (url) => {
      reads += 1;
      if (reads === 16) {
        saturated.resolve();
      }
      await release.promise;
      if (url.includes("app.bsky.actor.getProfile")) {
        return Response.json({
          did: new URL(url).searchParams.get("actor"),
          handle: "fixture.test",
        });
      }
      const did = new URL(url).searchParams.get("repo");
      return Response.json({
        cid: "bafyreibfn4d6xedoe6jixkcl266v2fhiwga2x3zzsnq6yawnago2kb5ouu",
        uri: `at://${did}/app.bsky.actor.contentVisibilityDeclaration/self`,
        value: { hideFromAlgorithmicRecommendations: false },
      });
    },
    maxConcurrentRequests: 16,
    maxRetries: 0,
  });
  const posts = Array.from({ length: 12 }, (_, index) => inventoryPost(index));
  const saved: ExternalPost[] = [];
  const hydrate = (ids: string[], startedAt: number) =>
    hydrateDiscoveryBatch(
      {
        client: {
          allowsRecommendations: (did) => client.allowsRecommendations(did),
          getPosts: () =>
            Promise.resolve(posts.filter((post) => ids.includes(post.id))),
        },
        publish: () => Promise.resolve(),
        store: {
          invalidate: () => Promise.resolve(),
          put: (permitted) => {
            saved.push(...permitted);
            return Promise.resolve();
          },
          read: () => Promise.resolve(saved),
        },
      },
      ids,
      startedAt
    );
  const batches = [posts.slice(0, 6), posts.slice(6)].map((batch) => ({
    ids: batch.map((post) => post.id),
    startedAt: 10_000,
  }));
  try {
    const pending = Promise.allSettled(
      batches.map((batch) => runHydrationJob(batch, hydrate, () => 10_000))
    );
    await saturated.promise;
    release.resolve();
    const results = await pending;
    expect(results[0]).toEqual({ status: "fulfilled", value: 6 });
    expect(results[1]).toMatchObject({
      reason: { code: "capacity" },
      status: "rejected",
    });
    expect(saved.map((post) => post.id)).toEqual(batches[0]?.ids ?? []);
    expect(await runHydrationJob(batches[1], hydrate, () => 10_000)).toBe(6);
    expect(saved.map((post) => post.id)).toEqual(posts.map((post) => post.id));
  } finally {
    release.resolve();
    client.close();
  }
});

test("overlapping hydration jobs share a bounded read budget without dropping authors", async () => {
  let active = 0;
  let peak = 0;
  const posts = Array.from({ length: 12 }, (_, index) => inventoryPost(index));
  const reader = createHydrationReader(
    {
      allowsRecommendations: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Bun.sleep(2);
        active -= 1;
        return true;
      },
      getPosts: (ids) =>
        Promise.resolve(posts.filter((post) => ids.includes(post.id))),
    },
    6
  );
  const saved: ExternalPost[] = [];
  const hydrate = (batch: ExternalPost[]) =>
    hydrateDiscoveryBatch(
      {
        client: reader.client,
        publish: () => Promise.resolve(),
        store: {
          invalidate: () => Promise.resolve(),
          put: (items) => {
            saved.push(...items);
            return Promise.resolve();
          },
          read: () => Promise.resolve(saved),
        },
      },
      batch.map((post) => post.id),
      Date.now()
    );
  try {
    expect(
      await Promise.all([hydrate(posts.slice(0, 6)), hydrate(posts.slice(6))])
    ).toEqual([6, 6]);
    expect(peak).toBe(6);
    expect(new Set(saved.map((post) => post.id)).size).toBe(12);
  } finally {
    reader.close();
  }
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
