import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { inventoryPost } from "./discovery-fixtures";
import { DiscoveryInventory } from "./discovery-inventory";
import { MemoryDiscoveryStore } from "./discovery-store";

test("a delayed reader reconciles progress after acquiring ownership instead of replaying a completed chain", async () => {
  const posts = Array.from({ length: 20 }, (_, index) => inventoryPost(index));
  const warming = Promise.withResolvers<{
    cursor: string;
    items: ExternalPost[];
    partial: false;
  }>();
  const started = Promise.withResolvers<undefined>();
  const paused = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let snapshots = 0;
  const positions: (string | undefined)[] = [];
  const store = {
    invalidate: () => Promise.resolve(),
    put: (arrivals: ExternalPost[]) => {
      posts.push(...arrivals);
      return Promise.resolve();
    },
    read: async () => {
      const captured = [...posts];
      snapshots += 1;
      if (snapshots === 2) {
        paused.resolve();
        await resume.promise;
      }
      return captured;
    },
  };
  const source = (_mode: string, cursor: string | undefined) => {
    positions.push(cursor);
    if (cursor === "next") {
      started.resolve();
      return warming.promise;
    }
    return Promise.resolve({
      cursor: cursor ? null : "next",
      items: cursor ? [inventoryPost(40)] : [],
      partial: false,
    });
  };
  const continuations = new MemoryDiscoveryStore();
  const first = new DiscoveryInventory(store, continuations, source);
  const second = new DiscoveryInventory(store, continuations, source);
  const head = await first.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  await started.promise;
  const delayed = second.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  await paused.promise;
  warming.resolve({ cursor: "last", items: [], partial: false });
  await Bun.sleep(0);
  resume.resolve();
  const page = await delayed;
  expect(positions).toEqual([undefined, "next", "last"]);
  expect(page?.items.map((post) => post.id)).toEqual([inventoryPost(40).id]);
  expect(page?.cursor).toBeNull();
});

test("replicas cannot start the next source page while its shared chain is already warming", async () => {
  const posts = Array.from({ length: 20 }, (_, index) => inventoryPost(index));
  const gate = Promise.withResolvers<{
    cursor: null;
    items: ExternalPost[];
    partial: false;
  }>();
  const started = Promise.withResolvers<undefined>();
  const positions: (string | undefined)[] = [];
  const store = {
    invalidate: () => Promise.resolve(),
    put: (arrivals: ExternalPost[]) => {
      posts.push(...arrivals);
      return Promise.resolve();
    },
    read: () => Promise.resolve(posts),
  };
  const source = (_mode: string, cursor: string | undefined) => {
    positions.push(cursor);
    if (cursor) {
      started.resolve();
      return gate.promise;
    }
    return Promise.resolve({ cursor: "next", items: [], partial: false });
  };
  const continuations = new MemoryDiscoveryStore();
  const first = new DiscoveryInventory(store, continuations, source, false, 10);
  const second = new DiscoveryInventory(
    store,
    continuations,
    source,
    false,
    10
  );
  const head = await first.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  await started.promise;
  const waiting = await second.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(waiting?.partial).toBe(true);
  expect(positions).toEqual([undefined, "next"]);
  gate.resolve({ cursor: null, items: [inventoryPost(40)], partial: false });
  await Bun.sleep(0);
  const resumed = await second.read(
    "personalized",
    waiting?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "all"
  );
  expect(resumed?.items.map((post) => post.id)).toEqual([inventoryPost(40).id]);
  expect(resumed?.cursor).toBeNull();
});

test("one coalesced refill crosses empty source pages and retains its exhausted position", async () => {
  const posts = Array.from({ length: 20 }, (_, index) => inventoryPost(index));
  const positions: (string | undefined)[] = [];
  const inventory = new DiscoveryInventory(
    {
      invalidate: () => Promise.resolve(),
      put: (arrivals) => {
        posts.push(...arrivals);
        return Promise.resolve();
      },
      read: () => Promise.resolve(posts),
    },
    new MemoryDiscoveryStore(),
    (_mode, cursor) => {
      positions.push(cursor);
      let next: string | null = "first";
      if (cursor) {
        next = cursor === "second" ? null : "second";
      }
      return Promise.resolve({
        cursor: next,
        items: cursor === "second" ? [inventoryPost(40)] : [],
        partial: false,
      });
    }
  );
  const head = await inventory.read(
    "personalized",
    undefined,
    "en",
    ["TypeScript"],
    "video"
  );
  await Bun.sleep(0);
  const next = await inventory.read(
    "personalized",
    head?.cursor ?? undefined,
    "en",
    ["TypeScript"],
    "video"
  );
  expect(positions).toEqual([undefined, "first", "second"]);
  expect(next?.items.map((post) => post.id)).toEqual([inventoryPost(40).id]);
  expect(next?.cursor).toBeNull();
});

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
  await Bun.sleep(0);
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
  expect(resumed?.cursor).toBeNull();
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

test("a failed lease release cannot pin the in-flight refill after storage recovers", async () => {
  const posts = [inventoryPost(1, "TypeScript")];
  const continuations = new MemoryDiscoveryStore();
  const release = continuations.release.bind(continuations);
  let attempts = 0;
  continuations.release = async (key, owner) => {
    await release(key, owner);
    if (attempts === 1) {
      throw new Error("Redis release failed");
    }
  };
  const inventory = new DiscoveryInventory(
    {
      invalidate: () => Promise.resolve(),
      put: () => Promise.resolve(),
      read: () => Promise.resolve(posts),
    },
    continuations,
    () => {
      attempts += 1;
      return Promise.resolve({ cursor: null, items: [], partial: true });
    }
  );
  await inventory.read("personalized", undefined, "en", ["TypeScript"], "all");
  await Bun.sleep(0);
  await inventory.read("personalized", undefined, "en", ["TypeScript"], "all");
  await Bun.sleep(0);
  expect(attempts).toBe(2);
});
