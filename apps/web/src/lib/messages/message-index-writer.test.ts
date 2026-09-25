import { beforeEach, describe, expect, test } from "bun:test";

import { createMemorySearchIndexStore } from "./memory-search-index";
import {
  createMessageIndexWriter,
  isStorageExhausted,
} from "./message-index-writer";
import type {
  IndexableMessage,
  IndexablePayload,
} from "./message-index-writer";
import { intersectPostingLists } from "./search-index-format";
import type { SearchIndexStore } from "./search-index-format";

const CONVO = "c1";

function message(
  id: string,
  overrides: Partial<IndexableMessage> = {}
): IndexableMessage {
  return {
    createdAt: new Date(1_700_000_000_000),
    id,
    senderId: "user-a",
    ...overrides,
  };
}

// A payload map standing in for the decryptor, so the writer's decisions can be
// driven deterministically without WebCrypto.
function makeHarness() {
  const payloads = new Map<
    string,
    IndexablePayload | "error" | "pending" | undefined
  >();
  const store = createMemorySearchIndexStore();
  const coverage: { indexedCount: number; pendingCount: number }[] = [];
  const writer = createMessageIndexWriter({
    conversationId: CONVO,
    getPayload: (id) => payloads.get(id),
    onCoverage: (next) => coverage.push(next),
    store,
  });
  return { coverage, payloads, store, writer };
}

// Reads one token's posting list and maps the interned rows back to message ids,
// which is the read path the search hook uses.
async function idsFor(
  store: SearchIndexStore,
  token: string
): Promise<string[]> {
  const list = await store.readPostingList(CONVO, token);
  const { rows } = intersectPostingLists([list], 1000);
  const resolved = await store.readRows(CONVO, Uint32Array.from(rows));
  return [...resolved.values()].map((facts) => facts.messageId);
}

describe("message index writer", () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  test("indexes a resolved message and makes it findable", async () => {
    harness.payloads.set("m1", { content: "deploy the service", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "service")).toEqual(["m1"]);
    expect(harness.writer.coverage().indexedCount).toBe(1);
  });

  test("coalesces a burst into one store write", async () => {
    const calls: number[] = [];
    const counting = createMemorySearchIndexStore();
    const original = counting.putEntries;
    counting.putEntries = (conversationId, entries) => {
      calls.push(entries.size);
      return original(conversationId, entries);
    };
    const payloads = new Map<string, IndexablePayload>();
    for (let i = 0; i < 50; i += 1) {
      payloads.set(`m${i}`, { content: `deploy note ${i}`, type: "text" });
    }
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store: counting,
    });
    // 50 separate consider() calls, as 50 rows arriving one at a time would.
    for (let i = 0; i < 50; i += 1) {
      writer.consider([message(`m${i}`)]);
    }
    await writer.flush();
    expect(calls).toEqual([50]);
    expect(await idsFor(counting, "note")).toHaveLength(50);
  });

  test("keeps a not-yet-decrypted row pending and indexes it later", async () => {
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    // Still pending: the payload has not resolved, so it must NOT be indexed.
    expect(harness.writer.coverage().pendingCount).toBe(1);
    expect(harness.writer.coverage().indexedCount).toBe(0);
    expect(await idsFor(harness.store, "deploy")).toEqual([]);

    // The payload lands; the next pass picks it up with no re-consider needed.
    harness.payloads.set("m1", { content: "deploy the service", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(harness.writer.coverage().pendingCount).toBe(0);
    expect(await idsFor(harness.store, "service")).toEqual(["m1"]);
  });

  test("retries a decrypt error rather than dropping the row", async () => {
    harness.payloads.set("m1", "error");
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(harness.writer.coverage().pendingCount).toBe(1);

    harness.payloads.set("m1", { content: "recovered text", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "recovered")).toEqual(["m1"]);
  });

  test("an evicted payload (undefined) stays pending, not forgotten", async () => {
    // Undefined is what the decryptor returns for an LRU-evicted entry: the row
    // exists, so it must not be treated as empty.
    harness.payloads.set("m1", undefined);
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(harness.writer.coverage().pendingCount).toBe(1);
    expect(harness.writer.coverage().indexedCount).toBe(0);
  });

  test("an edit replaces the entry, leaving no stale hit", async () => {
    harness.payloads.set("m1", { content: "deploy the service", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "service")).toEqual(["m1"]);

    harness.payloads.set("m1", { content: "rollback instead", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "service")).toEqual([]);
    expect(await idsFor(harness.store, "rollback")).toEqual(["m1"]);
  });

  test("editing a message to empty removes it from the index", async () => {
    harness.payloads.set("m1", { content: "temporary", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "temporary")).toEqual(["m1"]);

    harness.payloads.set("m1", { content: "   ", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "temporary")).toEqual([]);
    // Not retried forever: nothing to index is a settled state.
    expect(harness.writer.coverage().pendingCount).toBe(0);
  });

  test("a global delete removes the row from the index", async () => {
    harness.payloads.set("m1", { content: "goodbye", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    harness.writer.remove(["m1"]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "goodbye")).toEqual([]);
    expect(harness.writer.coverage().indexedCount).toBe(0);
  });

  test("a row already marked deleted is never indexed", async () => {
    harness.payloads.set("m1", { content: "gone", type: "text" });
    harness.writer.consider([message("m1", { deletedAt: new Date() })]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "gone")).toEqual([]);
    expect(harness.writer.coverage().indexedCount).toBe(0);
  });

  test("a store failure leaves the batch queued for a later attempt", async () => {
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "durable text", type: "text" }],
    ]);
    const store = createMemorySearchIndexStore();
    let failNext = true;
    const original = store.putEntries;
    store.putEntries = (conversationId, entries) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("quota exceeded"));
      }
      return original(conversationId, entries);
    };
    const coverage: { indexedCount: number; pendingCount: number }[] = [];
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      onCoverage: (next) => coverage.push(next),
      store,
    });

    writer.consider([message("m1")]);
    await writer.flush();
    // Nothing thrown, nothing indexed, and the row is still queued.
    expect(await idsFor(store, "durable")).toEqual([]);
    expect(writer.coverage().pendingCount).toBe(1);

    // The retry succeeds and the row becomes searchable.
    writer.consider([message("m1")]);
    await writer.flush();
    expect(await idsFor(store, "durable")).toEqual(["m1"]);
  });

  test("a remove failure does not throw", async () => {
    const store = createMemorySearchIndexStore();
    store.removeEntries = () => Promise.reject(new Error("db closed"));
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: () => harness.payloads.get("never-queried"),
      store,
    });
    writer.remove(["m1"]);
    await writer.flush();
    // Forgetting the id is what matters locally: the row cannot be clicked
    // because the transcript already dropped it.
    expect(writer.coverage().indexedCount).toBe(0);
  });

  test("indexes captions on post and media messages", async () => {
    harness.payloads.set("m1", { content: "look here", type: "post" });
    harness.payloads.set("m2", { content: "at this", type: "media" });
    harness.writer.consider([message("m1"), message("m2")]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "look")).toEqual(["m1"]);
    expect(await idsFor(harness.store, "this")).toEqual(["m2"]);
  });

  test("re-considering an unchanged row does not rewrite it", async () => {
    harness.payloads.set("m1", { content: "stable", type: "text" });
    const row = message("m1");
    harness.writer.consider([row]);
    await harness.writer.flush();

    const { store } = harness;
    let writes = 0;
    const original = store.putEntries;
    store.putEntries = (conversationId, entries) => {
      writes += 1;
      return original(conversationId, entries);
    };
    harness.writer.consider([row]);
    await harness.writer.flush();
    expect(writes).toBe(0);
  });

  // A full disk used to be indistinguishable from a conversation with no
  // matches: rows stayed pending, the walk reported no progress, and the bar kept
  // saying "No matches yet" forever. The writer now says so once.
  test("a full disk is surfaced rather than swallowed", async () => {
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "crowded", type: "text" }],
    ]);
    const store = createMemorySearchIndexStore();
    let full = 0;
    store.putEntries = () => {
      full += 1;
      return Promise.reject(new DOMException("full", "QuotaExceededError"));
    };
    let surfaced = 0;
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      onStorageFull: () => {
        surfaced += 1;
      },
      store,
    });
    writer.consider([message("m1")]);
    await writer.flush();
    expect(full).toBe(1);
    expect(surfaced).toBe(1);
    // Still queued, so an eviction that frees space lets the retry succeed.
    expect(writer.coverage().pendingCount).toBe(1);
  });

  test("a write that fails for another reason is not reported as full", async () => {
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "text", type: "text" }],
    ]);
    const store = createMemorySearchIndexStore();
    store.putEntries = () => Promise.reject(new Error("database closed"));
    let surfaced = 0;
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      onStorageFull: () => {
        surfaced += 1;
      },
      store,
    });
    writer.consider([message("m1")]);
    await writer.flush();
    expect(surfaced).toBe(0);
  });

  test("storage exhaustion is recognised across engines", () => {
    // Chrome/Firefox DOMException.
    expect(
      isStorageExhausted(new DOMException("x", "QuotaExceededError"))
    ).toBe(true);
    // Legacy numeric codes, seen on older Safari and in some wrappers.
    expect(isStorageExhausted({ code: 22 })).toBe(true);
    expect(isStorageExhausted({ code: 1014 })).toBe(true);
    expect(isStorageExhausted({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(
      true
    );
  });

  test("unrelated failures are not mistaken for a full disk", () => {
    expect(isStorageExhausted(new Error("network down"))).toBe(false);
    expect(isStorageExhausted({ code: 5 })).toBe(false);
    expect(isStorageExhausted(null)).toBe(false);
    expect(isStorageExhausted("nope")).toBe(false);
  });

  test("coverage is reported so the UI can show honest progress", async () => {
    harness.payloads.set("m1", { content: "indexed now", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const last = harness.coverage.at(-1);
    expect(last?.indexedCount).toBe(1);
    expect(last?.pendingCount).toBe(0);
  });
});
