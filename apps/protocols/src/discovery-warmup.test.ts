// Controlled asynchronous fixtures exercise cross-replica warmup ownership and retries.
// oxlint-disable require-await
import { expect, test } from "bun:test";

import { ProtocolError } from "@asm/protocols/contracts";
import type { DiscoveryPage } from "@asm/protocols/discovery";

import { inventoryPost } from "./discovery-fixtures";
import { MemoryDiscoveryStore } from "./discovery-store";
import { warmDiscoveryInventory } from "./discovery-warmup";

const watch = {
  content: "video" as const,
  explicit: false,
  locale: "en",
  mode: "personalized" as const,
  topics: ["anime"],
};
const head: DiscoveryPage = {
  cursor: "first",
  items: [inventoryPost(0)],
  partial: false,
};

test("successive refreshes and replicas warm deeper pages with two reads per invocation", async () => {
  const store = new MemoryDiscoveryStore();
  const reads: string[] = [];
  const retained: string[] = [];
  const read = async (cursor: string): Promise<DiscoveryPage> => {
    reads.push(cursor);
    const index = ["first", "second", "third", "fourth"].indexOf(cursor);
    return {
      cursor: ["second", "third", "fourth", null][index] ?? null,
      items: [inventoryPost(index + 1)],
      partial: false,
    };
  };
  const options = {
    head,
    read,
    retain: async (page: DiscoveryPage) => {
      retained.push(...page.items.map((p) => p.id));
    },
    signal: new AbortController().signal,
    store,
    watch,
  };
  await warmDiscoveryInventory(options);
  expect(reads).toEqual(["first", "second"]);
  await warmDiscoveryInventory({
    ...options,
    head: { ...head, cursor: "refreshed-head" },
  });
  expect(reads).toEqual(["first", "second", "third", "fourth"]);
  expect(new Set(retained).size).toBe(4);
  await warmDiscoveryInventory(options);
  expect(reads).toHaveLength(4);
  await warmDiscoveryInventory({
    ...options,
    head: { ...head, items: [inventoryPost(9)] },
  });
  expect(reads.slice(4)).toEqual(["first", "second"]);
});

test("a temporarily empty head does not strand a healthy saved continuation", async () => {
  const reads: string[] = [];
  const options = {
    head,
    read: async (cursor: string): Promise<DiscoveryPage> => {
      reads.push(cursor);
      return {
        cursor:
          new Map([
            ["first", "second"],
            ["second", "third"],
          ]).get(cursor) ?? null,
        items: [],
        partial: false,
      };
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store: new MemoryDiscoveryStore(),
    watch,
  };
  await warmDiscoveryInventory(options);
  await warmDiscoveryInventory({
    ...options,
    head: { cursor: null, items: [], partial: true },
  });
  expect(reads).toEqual(["first", "second", "third"]);
});

test("concurrent replicas do not duplicate a warmup chain", async () => {
  const store = new MemoryDiscoveryStore();
  const gate = Promise.withResolvers<DiscoveryPage>();
  let reads = 0;
  const options = {
    head,
    read: () => {
      reads += 1;
      return gate.promise;
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store,
    watch,
  };
  const pending = warmDiscoveryInventory(options);
  await Promise.resolve();
  await warmDiscoveryInventory(options);
  expect(reads).toBeLessThanOrEqual(1);
  gate.resolve({ cursor: null, items: [], partial: false });
  await pending;
  expect(reads).toBe(1);
});

test("window errors preserve the last successful cursor and expired sessions restart at the fresh head", async () => {
  const store = new MemoryDiscoveryStore();
  const reads: string[] = [];
  let fail: "unavailable" | "invalid_input" | undefined = "unavailable";
  const options = {
    head,
    read: async (cursor: string): Promise<DiscoveryPage> => {
      reads.push(cursor);
      if (cursor === "second" && fail) {
        throw new ProtocolError(fail, "Temporary failure");
      }
      return {
        cursor: cursor === "first" ? "second" : null,
        items: [],
        partial: false,
      };
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store,
    watch,
  };
  await expect(warmDiscoveryInventory(options)).rejects.toMatchObject({
    code: "unavailable",
  });
  fail = "invalid_input";
  await expect(
    warmDiscoveryInventory({ ...options, head: { ...head, cursor: "fresh" } })
  ).rejects.toMatchObject({ code: "invalid_input" });
  fail = undefined;
  await warmDiscoveryInventory({
    ...options,
    head: { ...head, cursor: "fresh" },
  });
  expect(reads).toEqual(["first", "second", "second", "fresh"]);
});

test("failed inventory writes cannot skip a page", async () => {
  const store = new MemoryDiscoveryStore();
  const reads: string[] = [];
  let fail = true;
  const options = {
    head,
    read: async (cursor: string): Promise<DiscoveryPage> => {
      reads.push(cursor);
      return { cursor: null, items: [], partial: false };
    },
    retain: async () => {
      if (fail) {
        throw new Error("Inventory unavailable");
      }
    },
    signal: new AbortController().signal,
    store,
    watch,
  };
  await expect(warmDiscoveryInventory(options)).rejects.toThrow(
    "Inventory unavailable"
  );
  fail = false;
  await warmDiscoveryInventory(options);
  expect(reads).toEqual(["first", "first"]);
});

test("explicit policy, locale and topics keep separate warmup positions", async () => {
  const store = new MemoryDiscoveryStore();
  const reads: string[] = [];
  const options = {
    head,
    read: async (cursor: string): Promise<DiscoveryPage> => {
      reads.push(cursor);
      return { cursor: null, items: [], partial: false };
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store,
    watch,
  };
  await warmDiscoveryInventory(options);
  await warmDiscoveryInventory({
    ...options,
    watch: { ...watch, explicit: true },
  });
  await warmDiscoveryInventory({
    ...options,
    watch: { ...watch, locale: "ja" },
  });
  await warmDiscoveryInventory({
    ...options,
    watch: { ...watch, topics: ["software"] },
  });
  expect(reads).toEqual(["first", "first", "first", "first"]);
});

test("partial empty results retain their continuation for the next refresh", async () => {
  const store = new MemoryDiscoveryStore();
  const reads: string[] = [];
  let recover = false;
  const options = {
    head,
    read: async (cursor: string): Promise<DiscoveryPage> => {
      reads.push(cursor);
      if (cursor === "first") {
        return { cursor: "second", items: [], partial: false };
      }
      return { cursor: null, items: [], partial: !recover };
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store,
    watch,
  };
  await warmDiscoveryInventory(options);
  recover = true;
  await warmDiscoveryInventory(options);
  expect(reads).toEqual(["first", "second", "second"]);
});

test("lost progress ownership stops warming without skipping the unrecorded page", async () => {
  const memory = new MemoryDiscoveryStore();
  let save = false;
  const store = {
    acquire: memory.acquire.bind(memory),
    get: memory.get.bind(memory),
    release: memory.release.bind(memory),
    set: (...args: Parameters<MemoryDiscoveryStore["set"]>) =>
      save ? memory.set(...args) : Promise.resolve(false),
  };
  const reads: string[] = [];
  const options = {
    head,
    read: async (cursor: string): Promise<DiscoveryPage> => {
      reads.push(cursor);
      return { cursor: "second", items: [], partial: false };
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store,
    watch,
  };
  await warmDiscoveryInventory(options);
  expect(reads).toEqual(["first"]);
  save = true;
  await warmDiscoveryInventory(options);
  expect(reads).toEqual(["first", "first", "second"]);
});

test("aborted warmup and heads without continuations do not read upstream", async () => {
  let reads = 0;
  const options = {
    head,
    read: async (): Promise<DiscoveryPage> => {
      reads += 1;
      return head;
    },
    retain: async () => {},
    signal: AbortSignal.abort(),
    store: new MemoryDiscoveryStore(),
    watch,
  };
  await warmDiscoveryInventory(options);
  await warmDiscoveryInventory({
    ...options,
    head: { ...head, cursor: null },
    signal: new AbortController().signal,
  });
  expect(reads).toBe(0);
});
