import { afterAll, expect, test } from "bun:test";

import Redis from "ioredis";

import { inventoryPost } from "./discovery-fixtures";
import { DiscoveryInventory, RedisInventoryStore } from "./discovery-inventory";
import { MemoryDiscoveryStore } from "./discovery-store";

const scope = `asm:protocols:{inventory-test:${crypto.randomUUID()}}`;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
});
const store = new RedisInventoryStore(redis, scope);
afterAll(async () => {
  await redis.del(
    ...[
      "posts",
      "time",
      "sizes",
      "bytes",
      "invalidated",
      "invalidated-time",
    ].map((suffix) => `${scope}:${suffix}`)
  );
  await redis.quit();
});

test("real Redis inventory serves isolated personas and video/engagement gates without any upstream client", async () => {
  const posts = Array.from({ length: 65 }, (_, index) =>
    inventoryPost(
      index,
      index < 50 ? "TypeScript" : "astronomy",
      index === 0 ? 0 : 20
    )
  );
  await store.put(posts.slice(0, 50), Date.now());
  await store.put(posts.slice(50), Date.now());
  const inventory = new DiscoveryInventory(store, new MemoryDiscoveryStore());
  const first = await inventory.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(first?.items).toHaveLength(20);
  expect(first?.items.every((post) => post.text.includes("TypeScript"))).toBe(
    true
  );
  const next = await inventory.read(
    "personalized",
    first?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(next?.items).toHaveLength(20);
  expect(
    next?.items.some((post) => first?.items.some((old) => old.id === post.id))
  ).toBe(false);
  expect(
    await inventory.read(
      "personalized",
      first?.cursor ?? undefined,
      "en",
      ["astronomy"],
      "all"
    )
  ).toBeNull();
  const other = await inventory.read(
    "latest",
    undefined,
    "en",
    ["astronomy"],
    "all"
  );
  expect(other?.items).toHaveLength(15);
  const trending = await inventory.read(
    "trending",
    undefined,
    "en",
    ["TypeScript"],
    "video"
  );
  expect(
    trending?.items.every(
      (post) =>
        post.upstreamCounts.likes === 20 &&
        post.media.some((media) => media.type === "video")
    )
  ).toBe(true);
  expect(trending?.items.some((post) => post.id === posts[0]?.id)).toBe(false);
  expect(
    await inventory.read("latest", undefined, "ja", ["TypeScript"], "all")
  ).toBeNull();
});

test("deletion/author opt-out fences stale hydration and cached continuation pages across replicas", async () => {
  const staleAt = Date.now() - 1000;
  const post = inventoryPost(400, "deletion-check");
  await store.put([post], staleAt);
  const replica = new RedisInventoryStore(redis, scope);
  await replica.invalidate(post.id);
  await store.put([post], staleAt);
  expect(await store.read([post.id])).toEqual([]);
  const authorPost = inventoryPost(401, "deletion-check");
  await store.put([authorPost], staleAt);
  await replica.invalidate(authorPost.author.id);
  await store.put([authorPost], staleAt);
  expect(await store.read([authorPost.id])).toEqual([]);
});

test("a sparse inventory continues through source pages without replaying local posts or crossing persona scopes", async () => {
  const first = inventoryPost(600, "sparse-continuation");
  const second = inventoryPost(601, "sparse-continuation");
  await store.put([first], Date.now());
  const calls: (string | undefined)[] = [];
  const inventory = new DiscoveryInventory(
    store,
    new MemoryDiscoveryStore(),
    (_mode, cursor) => {
      calls.push(cursor);
      return Promise.resolve(
        cursor
          ? { cursor: null, items: [first, second], partial: false }
          : { cursor: "source-page-2", items: [first], partial: false }
      );
    }
  );
  const head = await inventory.read(
    "personalized",
    undefined,
    "en",
    ["sparse-continuation"],
    "all"
  );
  expect(head?.items.map((post) => post.id)).toEqual([first.id]);
  expect(head?.cursor).toBeTruthy();
  expect(calls).toEqual([]);
  expect(
    await inventory.read(
      "personalized",
      head?.cursor ?? undefined,
      "en",
      ["other-persona"],
      "all"
    )
  ).toBeNull();
  expect(calls).toEqual([]);
  const bridge = await inventory.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["sparse-continuation"],
    "all"
  );
  expect(bridge?.items).toEqual([]);
  expect(bridge?.cursor).toBeTruthy();
  const tail = await inventory.read(
    "personalized",
    bridge?.cursor ?? undefined,
    "en",
    ["sparse-continuation"],
    "all"
  );
  expect(tail?.items.map((post) => post.id)).toEqual([second.id]);
  expect(tail?.cursor).toBeNull();
  expect(calls).toEqual([undefined, "source-page-2"]);
});

test("snapshots older than the policy TTL expire and byte/count limits remain bounded", async () => {
  const expired = inventoryPost(500);
  await store.put([expired], Date.now() - 121_000);
  expect(await store.read([expired.id])).toEqual([]);
  for (let offset = 0; offset < 2050; offset += 50) {
    // oxlint-disable-next-line no-await-in-loop -- each bounded insertion batch exercises the atomic cap.
    await store.put(
      Array.from({ length: 50 }, (_, index) =>
        inventoryPost(1000 + offset + index)
      ),
      Date.now()
    );
  }
  expect(await redis.zcard(`${scope}:time`)).toBe(2000);
  expect(Number(await redis.get(`${scope}:bytes`))).toBeLessThanOrEqual(
    24 * 1024 * 1024
  );
});

test("a safe inventory rechecks unlabeled media cues and a separate opt-in inventory can serve adult media", async () => {
  const topic = "optin-safety-regression";
  const safePost = inventoryPost(700, topic, 20);
  const adultPost = {
    ...inventoryPost(702, topic, 20),
    media: [
      {
        alt: "NSFW artwork",
        type: "video" as const,
        url: "https://video.bsky.app/fixture.m3u8",
      },
    ],
  };
  const quietPost = inventoryPost(704, topic, 0);
  await store.put([safePost, adultPost, quietPost], Date.now());
  const continuations = new MemoryDiscoveryStore();
  const safe = new DiscoveryInventory(store, continuations);
  const opted = new DiscoveryInventory(store, continuations, undefined, true);
  const standard = await safe.read("latest", undefined, "en", [topic], "all");
  expect(standard?.items.some((post) => post.id === adultPost.id)).toBe(false);
  expect(standard?.items.some((post) => post.id === quietPost.id)).toBe(true);
  const guest = await safe.read("latest", undefined, "en", [], "all");
  expect(guest?.items.some((post) => post.id === quietPost.id)).toBe(false);
  const enabled = await opted.read("latest", undefined, "en", [topic], "all");
  expect(enabled?.items.some((post) => post.id === adultPost.id)).toBe(true);
});
