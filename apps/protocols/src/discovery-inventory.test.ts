import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { inventoryPost } from "./discovery-fixtures";
import { DiscoveryInventory } from "./discovery-inventory";
import { MemoryDiscoveryStore } from "./discovery-store";

test("sparse heads warm shared inventory before the viewer asks for another page", async () => {
  const pending = Promise.withResolvers<{
    cursor: null;
    items: ExternalPost[];
    partial: false;
  }>();
  const posts = Array.from({ length: 25 }, (_, index) => inventoryPost(index));
  let reads = 0;
  const store = {
    invalidate: () => Promise.resolve(),
    put: () => Promise.resolve(),
    read: () => Promise.resolve(posts),
  };
  const continuations = new MemoryDiscoveryStore();
  const source = () => {
    reads += 1;
    return pending.promise;
  };
  const first = new DiscoveryInventory(store, continuations, source);
  const second = new DiscoveryInventory(store, continuations, source);
  const pages = await Promise.all([
    first.read("personalized", undefined, "en", ["TypeScript"], "all"),
    second.read("personalized", undefined, "en", ["TypeScript"], "all"),
  ]);
  expect(pages.every((page) => page?.items.length === 20)).toBe(true);
  expect(reads).toBe(1);
  pending.resolve({ cursor: null, items: [], partial: false });
  await Bun.sleep(0);
});

test("verified sparse arrivals return before an unresolved source refill and keep their continuation", async () => {
  const posts = Array.from({ length: 23 }, (_, index) =>
    inventoryPost(index, "TypeScript")
  );
  const pending = Promise.withResolvers<{
    cursor: null;
    items: ExternalPost[];
    partial: false;
  }>();
  const inventory = new DiscoveryInventory(
    {
      invalidate: () => Promise.resolve(),
      put: () => Promise.resolve(),
      read: () => Promise.resolve(posts),
    },
    new MemoryDiscoveryStore(),
    () => pending.promise
  );
  const head = await inventory.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  const page = await Promise.race([
    inventory.read(
      "personalized",
      head?.cursor ?? undefined,
      "en",
      ["TypeScript"],
      "all"
    ),
    (async () => {
      await Bun.sleep(100);
      return "blocked" as const;
    })(),
  ]);
  expect(page).not.toBe("blocked");
  if (page && page !== "blocked") {
    expect(page.items).toHaveLength(3);
    expect(page.partial).toBe(true);
    expect(page.cursor).not.toBeNull();
    expect(
      page.items.some((post) => head?.items.some((old) => old.id === post.id))
    ).toBe(false);
  }
  pending.resolve({ cursor: null, items: [], partial: false });
});

test("completed background refills preserve their next source position across inventory instances", async () => {
  const posts = Array.from({ length: 23 }, (_, index) =>
    inventoryPost(index, "TypeScript")
  );
  const continuations = new MemoryDiscoveryStore();
  const positions: (string | undefined)[] = [];
  const source = (_mode: string, position: string | undefined) => {
    positions.push(position);
    return Promise.resolve(
      position === undefined
        ? {
            cursor: "next-page",
            items: [inventoryPost(24, "TypeScript")],
            partial: false,
          }
        : {
            cursor: null,
            items: [inventoryPost(25, "TypeScript")],
            partial: false,
          }
    );
  };
  const store = {
    invalidate: () => Promise.resolve(),
    put: (arrivals: ExternalPost[]) => {
      posts.push(...arrivals);
      return Promise.resolve();
    },
    read: () => Promise.resolve(posts),
  };
  const first = new DiscoveryInventory(store, continuations, source);
  const head = await first.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  const sparse = await first.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  await Bun.sleep(0);
  const second = new DiscoveryInventory(store, continuations, source);
  const arrival = await second.read(
    "personalized",
    sparse?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  await Bun.sleep(0);
  const last = arrival?.cursor
    ? await second.read(
        "personalized",
        arrival?.cursor ?? undefined,
        "en",
        ["TypeScript"],
        "all"
      )
    : null;
  expect(positions).toEqual([undefined, "next-page"]);
  const delivered = [
    ...(sparse?.items ?? []),
    ...(arrival?.items ?? []),
    ...(last?.items ?? []),
  ].map((post) => post.id);
  expect(delivered).toContain(inventoryPost(24, "TypeScript").id);
  expect(delivered).toContain(inventoryPost(25, "TypeScript").id);
  expect(new Set(delivered).size).toBe(delivered.length);
  expect(last?.cursor ?? null).toBeNull();
});

test("an empty inventory retains a refill that finishes after the foreground timeout, including its next cursor", async () => {
  const posts = Array.from({ length: 20 }, (_, index) =>
    inventoryPost(index, "TypeScript")
  );
  const pending = Promise.withResolvers<{
    cursor: string;
    items: ExternalPost[];
    partial: false;
  }>();
  const positions: (string | undefined)[] = [];
  const source = (_mode: string, position: string | undefined) => {
    positions.push(position);
    return position === undefined
      ? pending.promise
      : Promise.resolve({ cursor: null, items: [], partial: false });
  };
  const store = {
    invalidate: () => Promise.resolve(),
    put: (arrivals: ExternalPost[]) => {
      posts.push(...arrivals);
      return Promise.resolve();
    },
    read: () => Promise.resolve(posts),
  };
  const continuations = new MemoryDiscoveryStore();
  const first = new DiscoveryInventory(store, continuations, source, false, 10);
  const head = await first.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  const waiting = await first.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(waiting?.items).toEqual([]);
  expect(waiting?.partial).toBe(true);
  expect(waiting?.cursor).toBeTruthy();
  const arrival = inventoryPost(21, "TypeScript");
  pending.resolve({ cursor: "source-next", items: [arrival], partial: false });
  await Bun.sleep(0);
  const second = new DiscoveryInventory(
    store,
    continuations,
    source,
    false,
    10
  );
  const resumed = await second.read(
    "personalized",
    waiting?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(resumed?.items.map((item) => item.id)).toEqual([arrival.id]);
  expect(positions.filter((position) => position === undefined)).toHaveLength(
    1
  );
  await Bun.sleep(0);
  const tail = await second.read(
    "personalized",
    resumed?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(tail?.cursor).toBeNull();
  expect(positions).toEqual([undefined, "source-next"]);
});

test("a partial source response without a continuation cannot mark the inventory exhausted", async () => {
  const posts = Array.from({ length: 20 }, (_, index) =>
    inventoryPost(index, "TypeScript")
  );
  let healthy = false;
  const store = {
    invalidate: () => Promise.resolve(),
    put: (arrivals: ExternalPost[]) => {
      posts.push(...arrivals);
      return Promise.resolve();
    },
    read: () => Promise.resolve(posts),
  };
  const inventory = new DiscoveryInventory(
    store,
    new MemoryDiscoveryStore(),
    () =>
      Promise.resolve({
        cursor: null,
        items: healthy ? [inventoryPost(22, "TypeScript")] : [],
        partial: !healthy,
      })
  );
  const head = await inventory.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  const outage = await inventory.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(outage?.partial).toBe(true);
  expect(outage?.cursor).toBeTruthy();
  healthy = true;
  const recovered = await inventory.read(
    "personalized",
    outage?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(recovered?.items.map((post) => post.id)).toEqual([
    inventoryPost(22, "TypeScript").id,
  ]);
  expect(recovered?.cursor).toBeNull();
});
