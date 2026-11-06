// Controlled asynchronous fixtures exercise cross-replica warmup ownership and retries.
// oxlint-disable require-await
import { expect, test } from "bun:test";

import { ProtocolError } from "@asm/protocols/contracts";
import type { DiscoveryPage } from "@asm/protocols/discovery";

import { createDiscoveryWarmupFailureReporter } from "../runtime/observability";
import { inventoryPost } from "./discovery-fixtures";
import { MemoryDiscoveryStore } from "./discovery-store";
import {
  createDiscoveryWarmupRunner,
  warmDiscoveryInventory,
} from "./discovery-warmup";

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

test("a pending warmup finishes its work slice without an outage warning", async () => {
  const warnings: Record<string, unknown>[] = [];
  const report = createDiscoveryWarmupFailureReporter({
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: (fields) => {
      warnings.push(fields);
    },
  });
  const pending = Promise.withResolvers<DiscoveryPage>();
  await warmDiscoveryInventory({
    head,
    read: () => pending.promise,
    retain: async () => {},
    signal: new AbortController().signal,
    store: new MemoryDiscoveryStore(),
    timeBudgetMs: 10,
    watch,
  }).catch(report);
  expect(warnings).toEqual([]);
});

test("video warming traverses six sparse pages without making the viewer request them", async () => {
  const reads: string[] = [];
  const retained: string[] = [];
  await warmDiscoveryInventory({
    head,
    maxPages: 6,
    read: (cursor) => {
      reads.push(cursor);
      return Promise.resolve({
        cursor: `next-${reads.length}`,
        items: reads.length === 6 ? [inventoryPost(50)] : [],
        partial: true,
      });
    },
    retain: (page) => {
      retained.push(...page.items.map((post) => post.id));
      return Promise.resolve();
    },
    signal: new AbortController().signal,
    store: new MemoryDiscoveryStore(),
    watch,
  });
  expect(reads).toHaveLength(6);
  expect(retained).toEqual([inventoryPost(50).id]);
});

test("a warmup deadline cannot retain late data or advance its saved position", async () => {
  const gate = Promise.withResolvers<DiscoveryPage>();
  const store = new MemoryDiscoveryStore();
  const reads: string[] = [];
  const retained: string[] = [];
  const options = {
    head,
    read: (cursor: string) => {
      reads.push(cursor);
      return gate.promise;
    },
    retain: (page: DiscoveryPage) => {
      retained.push(...page.items.map((post) => post.id));
      return Promise.resolve();
    },
    signal: new AbortController().signal,
    store,
    timeBudgetMs: 10,
    watch,
  };
  await warmDiscoveryInventory(options);
  gate.resolve({ cursor: null, items: [inventoryPost(51)], partial: false });
  await Bun.sleep(0);
  expect(retained).toEqual([]);
  await warmDiscoveryInventory({ ...options, timeBudgetMs: 1000 });
  expect(reads).toEqual(["first", "first"]);
  expect(retained).toEqual([inventoryPost(51).id]);
});

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

test("finishing an older chain does not mark a newer head as warmed", async () => {
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
  const refreshed = {
    ...options,
    head: { ...head, cursor: "new-head", items: [inventoryPost(9)] },
  };
  await warmDiscoveryInventory(refreshed);
  expect(reads).toEqual(["first", "second", "third"]);
  await warmDiscoveryInventory(refreshed);
  expect(reads).toEqual(["first", "second", "third", "new-head"]);
  await warmDiscoveryInventory(refreshed);
  expect(reads).toHaveLength(4);
});

test.each(["read", "retain", "partial"] as const)(
  "a first-page %s failure retries its saved position after the head changes",
  async (failure) => {
    const reads: string[] = [];
    let recovered = false;
    const options = {
      head,
      read: async (cursor: string): Promise<DiscoveryPage> => {
        reads.push(cursor);
        if (!recovered && failure === "read") {
          throw new ProtocolError("unavailable", "Read unavailable");
        }
        return {
          cursor: null,
          items: [],
          partial: !recovered && failure === "partial",
        };
      },
      retain: async () => {
        if (!recovered && failure === "retain") {
          throw new Error("Inventory unavailable");
        }
      },
      signal: new AbortController().signal,
      store: new MemoryDiscoveryStore(),
      watch,
    };
    const pending = warmDiscoveryInventory(options);
    await (failure === "partial" ? pending : expect(pending).rejects.toThrow());
    recovered = true;
    await warmDiscoveryInventory({
      ...options,
      head: { ...head, cursor: "new-head", items: [inventoryPost(9)] },
    });
    expect(reads).toEqual(["first", "first"]);
  }
);

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

test("explicit policy, locale, topics, content and mode keep separate warmup positions", async () => {
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
  await warmDiscoveryInventory({
    ...options,
    watch: { ...watch, content: "all" },
  });
  await warmDiscoveryInventory({
    ...options,
    watch: { ...watch, mode: "latest" },
  });
  expect(reads).toEqual(["first", "first", "first", "first", "first", "first"]);
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
  let saves = 0;
  let recover = false;
  const store = {
    acquire: memory.acquire.bind(memory),
    get: memory.get.bind(memory),
    release: memory.release.bind(memory),
    set: (...args: Parameters<MemoryDiscoveryStore["set"]>) => {
      saves += 1;
      return recover || saves === 1
        ? memory.set(...args)
        : Promise.resolve(false);
    },
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
  recover = true;
  await warmDiscoveryInventory(options);
  expect(reads).toEqual(["first", "first", "second"]);
});

test("a failed initial position save does not start upstream work", async () => {
  const memory = new MemoryDiscoveryStore();
  let reads = 0;
  await warmDiscoveryInventory({
    head,
    read: async () => {
      reads += 1;
      return head;
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store: {
      acquire: memory.acquire.bind(memory),
      get: memory.get.bind(memory),
      release: memory.release.bind(memory),
      set: () => Promise.resolve(false),
    },
    watch,
  });
  expect(reads).toBe(0);
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

test("an upstream timeout remains a failure before the warmup slice expires", async () => {
  const failure = new DOMException("Upstream deadline", "TimeoutError");
  await expect(
    warmDiscoveryInventory({
      head,
      read: () => Promise.reject(failure),
      retain: async () => {},
      signal: new AbortController().signal,
      store: new MemoryDiscoveryStore(),
      timeBudgetMs: 1000,
      watch,
    })
  ).rejects.toBe(failure);
});

test("caller cancellation releases warmup ownership and still propagates", async () => {
  const abort = new AbortController();
  const failure = new Error("Caller stopped");
  const pending = Promise.withResolvers<DiscoveryPage>();
  const store = new MemoryDiscoveryStore();
  await expect(
    warmDiscoveryInventory({
      head,
      read: () => {
        abort.abort(failure);
        return pending.promise;
      },
      retain: async () => {},
      signal: abort.signal,
      store,
      watch,
    })
  ).rejects.toMatchObject({ name: "AbortError" });
  const reads: string[] = [];
  await warmDiscoveryInventory({
    head,
    read: async (cursor) => {
      reads.push(cursor);
      return { ...head, cursor: null };
    },
    retain: async () => {},
    signal: new AbortController().signal,
    store,
    watch,
  });
  expect(reads).toEqual(["first"]);
});

test("background depth shares a bounded budget and skipped scopes can retry after completion", async () => {
  const run = createDiscoveryWarmupRunner();
  const gate = Promise.withResolvers<null>();
  const first = run(async () => {
    await gate.promise;
  });
  const second = run(async () => {
    await gate.promise;
  });
  let skippedRan = false;
  expect(
    await run(async () => {
      skippedRan = true;
    })
  ).toBe(false);
  expect(skippedRan).toBe(false);
  gate.resolve(null);
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(
    await run(async () => {
      skippedRan = true;
    })
  ).toBe(true);
  expect(skippedRan).toBe(true);
});

test("a rejected background slice releases its slot without hiding the failure", async () => {
  const run = createDiscoveryWarmupRunner();
  const gate = Promise.withResolvers<null>();
  const pending = run(async () => {
    await gate.promise;
  });
  const failure = new Error("Inventory unavailable");
  await expect(run(() => Promise.reject(failure))).rejects.toBe(failure);
  expect(await run(async () => {})).toBe(true);
  gate.resolve(null);
  await pending;
});
