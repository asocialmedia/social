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
import {
  intersectPostingLists,
  selectNewestFirstWindow,
} from "./search-index-format";
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

async function pendingIdsFor(
  store: SearchIndexStore,
  conversationId: string
): Promise<string[]> {
  const messageIds: string[] = [];
  let after: string | undefined;
  // oxlint-disable no-await-in-loop -- each page cursor depends on the previous page
  while (true) {
    const page = await store.readPendingPage(conversationId, {
      after,
      limit: 256,
    });
    messageIds.push(...page);
    if (page.length < 256) {
      return messageIds;
    }
    after = page.at(-1);
  }
  // oxlint-enable no-await-in-loop
}

// Reads one token's posting list and maps the interned rows back to message ids,
// which is the read path the search hook uses.
async function idsFor(
  store: SearchIndexStore,
  token: string
): Promise<string[]> {
  const list = await store.readPostingList(CONVO, token);
  const times = await store.readPostingTimes(CONVO, token);
  const { matches } = intersectPostingLists([{ rows: list, times }]);
  const { window } = selectNewestFirstWindow(matches, 1000);
  const resolved = await store.readRows(
    CONVO,
    Uint32Array.from(window.map((match) => match.row))
  );
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

  // The regression that mattered most, and the reason the coalescing window is a
  // timer rather than a microtask.
  //
  // Coalescing 50 SYNCHRONOUS calls was never the problem. A decryptor delivers
  // completions on their own ticks, so the shape that actually occurs is 50
  // calls each separated by a macrotask. Under a microtask window each of those
  // became its own transaction, because a microtask runs before IndexedDB can
  // finish one: the writer then committed back-to-back with no gap, held the
  // write lock essentially all the time, and every search read queued behind it
  // forever. In the browser that presented as coverage stuck at zero and queries
  // that never resolved.
  test("coalesces rows arriving on separate ticks into one commit", async () => {
    const calls: number[] = [];
    const counting = createMemorySearchIndexStore();
    const original = counting.putEntries;
    counting.putEntries = (conversationId, entries) => {
      calls.push(entries.size);
      return original(conversationId, entries);
    };
    const payloads = new Map<string, IndexablePayload>();
    for (let i = 0; i < 20; i += 1) {
      payloads.set(`t${i}`, { content: `release note ${i}`, type: "text" });
    }
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store: counting,
    });
    for (let i = 0; i < 20; i += 1) {
      writer.consider([message(`t${i}`)]);
      // A real macrotask between arrivals, as a decryptor completion would.
      // oxlint-disable no-await-in-loop -- the separate ticks ARE the test; awaiting these in parallel would collapse them into a single tick and test nothing
      // oxlint-disable-next-line promise/avoid-new -- a timer has no async/await form
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      // oxlint-enable no-await-in-loop
    }
    await writer.flush();
    expect(calls).toEqual([20]);
    expect(await idsFor(counting, "release")).toHaveLength(20);
  });

  // Batches used to overlap: a timer-fired batch and a flush-driven batch could
  // iterate the same `pending` map concurrently, so each saw a partial view and
  // `lastResult` reported whichever finished last. In the browser that is how a
  // walk reported thousands of commits while the row count never moved.
  test("never runs two batches at once", async () => {
    const counting = createMemorySearchIndexStore();
    let depth = 0;
    let maxDepth = 0;
    const original = counting.putEntries;
    counting.putEntries = async (conversationId, entries) => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      try {
        return await original(conversationId, entries);
      } finally {
        depth -= 1;
      }
    };
    const payloads = new Map<string, IndexablePayload>();
    for (let i = 0; i < 6; i += 1) {
      payloads.set(`c${i}`, { content: `deploy note ${i}`, type: "text" });
    }
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store: counting,
    });
    writer.consider([
      message("c0"),
      message("c1"),
      message("c2"),
      message("c3"),
      message("c4"),
      message("c5"),
    ]);
    // Two flushes racing each other must serialize behind one drain, not run
    // two batches over the same map.
    await Promise.all([writer.flush(), writer.flush()]);
    expect(maxDepth).toBe(1);
    expect(await idsFor(counting, "deploy")).toHaveLength(6);
  });

  test("a removal waits behind an in-flight index write and stays final", async () => {
    const store = createMemorySearchIndexStore();
    const originalPut = store.putEntries;
    let releaseWrite: (() => void) | null = null;
    let reportWriteStarted: (() => void) | null = null;
    // oxlint-disable-next-line promise/avoid-new -- explicit gates expose the interleaving under test
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    // oxlint-disable-next-line promise/avoid-new -- explicit gates expose the interleaving under test
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    store.putEntries = async (conversationId, entries) => {
      reportWriteStarted?.();
      await writeGate;
      await originalPut(conversationId, entries);
    };
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: () => ({ content: "remove this", type: "text" }),
      store,
    });
    writer.consider([message("m1")]);
    const firstFlush = writer.flush();
    await writeStarted;
    writer.remove(["m1"]);
    const release = releaseWrite;
    if (!release) {
      throw new Error("Expected the blocked write to be releasable");
    }
    release();
    await firstFlush;
    await writer.flush();
    expect(await idsFor(store, "remove")).toEqual([]);
    expect(await pendingIdsFor(store, CONVO)).toEqual([]);
  });

  // An empty flush must stay silent. It used to notify on every pass, and one
  // subscriber re-considered on every notification -- a self-sustaining loop
  // of empty commits (~8/sec in the browser) that burned writes forever and,
  // worse, cancelled any search read slower than its cadence before it could
  // land, so results silently never arrived on large conversations.
  test("an empty flush does not notify", async () => {
    let notifications = 0;
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: () => {},
      onCoverage: () => {
        notifications += 1;
      },
      store,
    });
    writer.consider([message("m1")]);
    await writer.flush();
    const afterFirst = notifications;
    await writer.flush();
    await writer.flush();
    expect(afterFirst).toBe(1);
    expect(notifications).toBe(1);
  });

  test("a row considered mid-flush is drained by the same flush", async () => {
    const counting = createMemorySearchIndexStore();
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "deploy the service", type: "text" }],
      ["late", { content: "deploy late arrival", type: "text" }],
    ]);
    let writer: ReturnType<typeof createMessageIndexWriter> | null = null;
    const original = counting.putEntries;
    counting.putEntries = (conversationId, entries) => {
      // A transcript completion landing while the batch is committing: the row
      // must join the drain in progress rather than wait out a window.
      if (entries.has("m1") && writer) {
        writer.consider([message("late")]);
      }
      return original(conversationId, entries);
    };
    writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store: counting,
    });
    writer.consider([message("m1")]);
    await writer.flush();
    expect(await idsFor(counting, "late")).toEqual(["late"]);
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

  test("a conversation reset clears durable rows and cached signatures", async () => {
    const current = message("m1");
    harness.payloads.set("m1", { content: "deploy safely", type: "text" });
    harness.writer.consider([current]);
    await harness.writer.flush();

    expect(await idsFor(harness.store, "deploy")).toEqual(["m1"]);
    expect(await harness.writer.clearConversation()).toBe(true);
    expect(await idsFor(harness.store, "deploy")).toEqual([]);
    expect(harness.writer.coverage().indexedCount).toBe(0);

    harness.writer.consider([current]);
    await harness.writer.flush();
    expect(await idsFor(harness.store, "deploy")).toEqual(["m1"]);
  });

  test("a failed conversation reset is reported and can be retried", async () => {
    const clear = harness.store.clearConversation;
    let failNext = true;
    harness.store.clearConversation = (conversationId) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("storage unavailable"));
      }
      return clear(conversationId);
    };
    harness.payloads.set("m1", { content: "deploy safely", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    expect(await harness.writer.clearConversation()).toBe(false);
    expect(await harness.writer.clearConversation()).toBe(true);
    expect(await idsFor(harness.store, "deploy")).toEqual([]);
  });

  test("waitable removals report storage failures and retry cleanly", async () => {
    harness.payloads.set("m1", { content: "deploy safely", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const { removeEntries } = harness.store;
    let failNext = true;
    harness.store.removeEntries = (conversationId, messageIds) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("storage unavailable"));
      }
      return removeEntries(conversationId, messageIds);
    };

    expect(await harness.writer.removeAndWait(["m1"])).toBe(false);
    expect(await harness.writer.removeAndWait(["m1"])).toBe(true);
    expect(await idsFor(harness.store, "deploy")).toEqual([]);
  });

  test("an empty edit removal failure stays pending until the stale row is gone", async () => {
    harness.payloads.set("m1", { content: "deploy safely", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const { removeEntries } = harness.store;
    let failNext = true;
    harness.store.removeEntries = (conversationId, messageIds) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("storage unavailable"));
      }
      return removeEntries(conversationId, messageIds);
    };
    harness.payloads.set("m1", { content: "", type: "text" });
    harness.writer.consider([message("m1")]);

    const first = await harness.writer.flush();
    expect(first.failed).toBe(true);
    expect(first.stillPending).toEqual(["m1"]);
    expect(await idsFor(harness.store, "deploy")).toEqual(["m1"]);

    const second = await harness.writer.flush();
    expect(second.failed).toBe(false);
    expect(await idsFor(harness.store, "deploy")).toEqual([]);
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

  // These cover the gap that made search quietly lossy: the pending set was
  // in-memory only while the backfill advanced its cursor past those rows, so a
  // decrypt timeout or a refused write left a permanent hole nothing revisited.
  test("a row whose payload never arrives is persisted, not just queued", async () => {
    harness.payloads.set("m1", "pending");
    harness.writer.consider([message("m1")]);
    const result = await harness.writer.flush();
    expect(result.stillPending).toEqual(["m1"]);
    expect(result.committed).toEqual([]);
    // And it is on disk, not only in this process.
    expect(await pendingIdsFor(harness.store, CONVO)).toEqual(["m1"]);
  });

  test("a refused write is persisted so the row is not lost with the tab", async () => {
    const store = createMemorySearchIndexStore();
    const original = store.putEntries;
    store.putEntries = () => Promise.reject(new Error("db closed"));
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "durable text", type: "text" }],
    ]);
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    writer.consider([message("m1")]);
    const result = await writer.flush();
    expect(result.failed).toBe(false);
    expect(result.stillPending).toEqual(["m1"]);
    expect(await pendingIdsFor(store, CONVO)).toEqual(["m1"]);

    // A later session's writer loads the queue and can pick the row back up.
    const recovered = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    expect(await recovered.durablePending(["m1"])).toEqual(["m1"]);
    store.putEntries = original;
  });

  test("persists every pending id beyond the in-session retry cap", async () => {
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: () => "pending",
      store,
    });
    const messages = Array.from({ length: 5001 }, (_, index) =>
      message(`pending-${index}`)
    );
    writer.consider(messages);
    const result = await writer.flush();
    expect(result.failed).toBe(false);
    expect(result.stillPending).toHaveLength(5001);
    expect(await pendingIdsFor(store, CONVO)).toHaveLength(5001);
  });

  test("a queue that cannot be persisted reports failure, so the cursor stays put", async () => {
    const store = createMemorySearchIndexStore();
    store.updatePending = () => Promise.reject(new Error("quota"));
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "text", type: "text" }],
    ]);
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    writer.consider([message("m1")]);
    const result = await writer.flush();
    // The rows committed, but the bookkeeping did not, so the backfill must not
    // treat this page as safely covered.
    expect(result.committed).toEqual(["m1"]);
    expect(result.failed).toBe(true);
  });

  test("a row that commits leaves the durable queue", async () => {
    harness.payloads.set("m1", "pending");
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await pendingIdsFor(harness.store, CONVO)).toEqual(["m1"]);

    harness.payloads.set("m1", { content: "finally here", type: "text" });
    harness.writer.consider([message("m1")]);
    const result = await harness.writer.flush();
    expect(result.committed).toEqual(["m1"]);
    expect(await pendingIdsFor(harness.store, CONVO)).toEqual([]);
  });

  test("a deleted row leaves the durable queue", async () => {
    harness.payloads.set("m1", "pending");
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    expect(await pendingIdsFor(harness.store, CONVO)).toEqual(["m1"]);

    harness.writer.remove(["m1"]);
    await harness.writer.flush();
    expect(await pendingIdsFor(harness.store, CONVO)).toEqual([]);
  });

  test("pending rows are retried when their payload arrives", async () => {
    let notify: (() => void) | null = null;
    const payloads = new Map<string, IndexablePayload>();
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
      subscribeToPayloads: (listener) => {
        notify = listener;
        return () => {
          notify = null;
        };
      },
    });
    writer.consider([message("m1")]);
    await writer.flush();
    // Nothing arrived, so nothing was written.
    expect(await idsFor(harness.store, "nothing")).toEqual([]);

    // The payload lands and the decryptor notifies. Without this the row waited
    // for unrelated activity, and a quiet conversation never caught up.
    payloads.set("m1", { content: "arrived late", type: "text" });
    notify?.();
    await writer.flush();
    const found = await idsFor(store, "arrived");
    expect(found).toEqual(["m1"]);
    expect(await pendingIdsFor(store, CONVO)).toEqual([]);
  });

  test("a payload notification with nothing pending does not write", async () => {
    const store = createMemorySearchIndexStore();
    let notify: (() => void) | null = null;
    let writes = 0;
    const original = store.putEntries;
    store.putEntries = (conversationId, entries) => {
      writes += 1;
      return original(conversationId, entries);
    };
    createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: () => ({ content: "x", type: "text" }),
      store,
      subscribeToPayloads: (listener) => {
        notify = listener;
        return () => {
          notify = null;
        };
      },
    });
    notify?.();
    await Promise.resolve();
    // An idle conversation must not wake the writer on every decrypt anywhere.
    expect(writes).toBe(0);
  });

  test("dispose unsubscribes and flushes the final queued batch", async () => {
    let notify: (() => void) | null = null;
    let unsubscribed = false;
    let writes = 0;
    const store = createMemorySearchIndexStore();
    const { putEntries } = store;
    store.putEntries = (conversationId, entries) => {
      writes += 1;
      return putEntries(conversationId, entries);
    };
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: () => ({ content: "final batch", type: "text" }),
      store,
      subscribeToPayloads: (listener) => {
        notify = listener;
        return () => {
          unsubscribed = true;
          notify = null;
        };
      },
    });
    writer.consider([message("m1")]);

    const result = await writer.dispose();
    notify?.();
    expect(unsubscribed).toBe(true);
    expect(result.committed).toEqual(["m1"]);
    expect(writes).toBe(1);
    expect(await idsFor(store, "final")).toEqual(["m1"]);
  });

  test("bounds the in-memory signature cache for long backfills", async () => {
    const payloads = new Map<string, IndexablePayload>();
    const messages = [];
    for (let index = 0; index < 1100; index += 1) {
      const id = `bounded-${index}`;
      payloads.set(id, { content: `message ${index}`, type: "text" });
      messages.push(message(id));
    }
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store: createMemorySearchIndexStore(),
    });
    writer.consider(messages);
    await writer.flush();
    expect(writer.coverage().indexedCount).toBe(1024);
  });

  test("coverage counts the durable queue, not the in-memory retry set", async () => {
    harness.payloads.set("m1", "pending");
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    // A row dropped from the in-session retry set is still a gap in coverage, and
    // the bar has to keep saying so.
    expect(harness.writer.coverage().pendingCount).toBe(1);
  });

  // The drift B closes: the writer stored captions only while the ranked
  // in-memory path appended a kind label, so the same message matched before a
  // reload and not after. Both now go through one extractor.
  test.each([
    ["text", { content: "hello world", type: "text" as const }, "hello"],
    [
      "captioned post",
      { content: "look at this", type: "post" as const },
      "look",
    ],
    ["captionless post", { type: "post" as const }, "shared a post"],
    [
      "captionless image",
      { kind: "image" as const, type: "media" as const },
      "shared an image",
    ],
    [
      "captionless gif",
      { kind: "gif" as const, type: "media" as const },
      "shared a gif",
    ],
    [
      "album",
      {
        images: [{}, {}, {}],
        kind: "image" as const,
        type: "media" as const,
      },
      "shared 3 images",
    ],
    [
      "captioned image keeps both the caption and the label",
      {
        content: "birthday",
        kind: "image" as const,
        type: "media" as const,
      },
      "birthday",
    ],
  ] as const)(
    "the persisted index agrees with the in-memory path for %s",
    async (_name, payload, expectedToken) => {
      const ids = expectedToken.split(" ");
      harness.payloads.set("m1", { ...payload });
      harness.writer.consider([message("m1")]);
      await harness.writer.flush();
      // Indexed, and findable by the same words the ranked list would use.
      // Sequential deliberately: the assertion order must match the token order,
      // and these are point reads against an in-memory store.
      // oxlint-disable no-await-in-loop -- ordered assertions, point reads
      for (const token of ids) {
        expect(await idsFor(harness.store, token)).toEqual(["m1"]);
      }
      // oxlint-enable no-await-in-loop
    }
  );

  test("coverage is reported so the UI can show honest progress", async () => {
    harness.payloads.set("m1", { content: "indexed now", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const last = harness.coverage.at(-1);
    expect(last?.indexedCount).toBe(1);
    expect(last?.pendingCount).toBe(0);
  });
});

// A backfill walk commits once per page, and each commit re-seals the whole row
// table. The transcript's decryptor completions call `consider` continuously
// alongside the walk, so without deferral the walk paid for a parallel stream of
// full-table commits contending for the same IndexedDB write lock.
describe("write deferral", () => {
  test("deferring holds writes until the caller flushes", async () => {
    const payloads = new Map<string, IndexablePayload>();
    for (let index = 0; index < 20; index += 1) {
      payloads.set(`m${index}`, { content: `deploy ${index}`, type: "text" });
    }
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    writer.setDeferring(true);
    writer.consider(
      [...payloads.values()].map((_, index) => ({ id: `m${index}` }))
    );
    // Nothing committed: the rows are queued, not written.
    expect(writer.coverage().indexedCount).toBe(0);
    expect(writer.coverage().pendingCount).toBe(20);
    // The walk's own flush is the commit point, and it writes everything queued.
    const result = await writer.flush();
    expect(result.committed).toHaveLength(20);
    expect(writer.coverage().indexedCount).toBe(20);
  });

  test("leaving deferral flushes whatever is still queued", async () => {
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "deploy", type: "text" }],
    ]);
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    writer.setDeferring(true);
    writer.consider([{ id: "m1" }]);
    expect(writer.coverage().indexedCount).toBe(0);
    // The walk ended without an explicit flush; the rows must not be stranded.
    writer.setDeferring(false);
    await writer.flush();
    expect(writer.coverage().indexedCount).toBe(1);
  });

  test("without deferral writes still land on their own", async () => {
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "deploy", type: "text" }],
    ]);
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    writer.consider([{ id: "m1" }]);
    await writer.flush();
    expect(writer.coverage().indexedCount).toBe(1);
  });

  test("toggling deferral twice is a no-op and does not double-write", async () => {
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "deploy", type: "text" }],
    ]);
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    writer.setDeferring(true);
    writer.setDeferring(true);
    writer.setDeferring(false);
    writer.setDeferring(false);
    writer.consider([{ id: "m1" }]);
    await writer.flush();
    expect(writer.coverage().indexedCount).toBe(1);
  });
});

// ---- shared-content refs, written on the same pass as the text rows --------

// ---- shared-content refs, written on the same pass as the text rows --------

describe("message index writer: shared refs", () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  function page(kind: "link" | "media" | "post") {
    return harness.store.readSharedRefs(CONVO, kind, { limit: 50 });
  }

  test("persists a post share alongside its text row", async () => {
    harness.payloads.set("m1", {
      content: "look at this",
      postId: "p1",
      type: "post",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    const stored = await page("post");
    expect(stored.items.map((item) => item.postId)).toEqual(["p1"]);
    // Both halves in one pass, so the searchable text and the tab row can never
    // come from different reads of the same message.
    expect(await idsFor(harness.store, "look")).toEqual(["m1"]);
  });

  test("persists every image of an album, indexed by album position", async () => {
    harness.payloads.set("m1", {
      images: [{ url: "/api/media/a" }, { url: "/api/media/b" }],
      kind: "image",
      type: "media",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    const stored = await page("media");
    expect(stored.items.map((item) => item.index)).toEqual([0, 1]);
    expect(stored.items.map((item) => item.url)).toEqual([
      "/api/media/a",
      "/api/media/b",
    ]);
  });

  // A captionless image has no words of its own, so the text index holds it under
  // a synthesized kind label. That label is what makes it findable in the
  // transcript, so the row is expected — and the point of the shared extractor is
  // that the tab and the search bar agree on that.
  test("persists refs for a message whose text is only a synthesized label", async () => {
    harness.payloads.set("m1", {
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    const stored = await page("media");
    expect(stored.items).toHaveLength(1);
    expect(await idsFor(harness.store, "shared")).toEqual(["m1"]);
  });

  test("persists a link from a caption", async () => {
    harness.payloads.set("m1", {
      content: "read https://example.com/a",
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const stored = await page("link");
    expect(stored.items.map((item) => item.url)).toEqual([
      "https://example.com/a",
    ]);
  });

  // The bug the refs-aware signature exists for: an edit that swaps one link for
  // another leaves every token identical, so a text-only signature would treat the
  // row as current and the panel would keep showing a URL the author removed.
  test("an edit that swaps a link rewrites the ref even though no token changes", async () => {
    harness.payloads.set("m1", {
      content: "read https://example.com/old",
      type: "text",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const before = await page("link");
    expect(before.items.map((item) => item.url)).toEqual([
      "https://example.com/old",
    ]);

    harness.payloads.set("m1", {
      content: "read https://example.com/new",
      type: "text",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    const after = await page("link");
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.url).toBe("https://example.com/new");
    // The count must not double, or the tab's label drifts from its rows.
    const counts = await harness.store.readSharedRefsCounts(CONVO);
    expect(counts?.link).toBe(1);
  });

  // The second half of the same bug: refs that go to ZERO are not in the write
  // batch at all, so nothing would drop the old rows and nothing would point at
  // them either.
  test("an edit that strips every ref leaves none behind", async () => {
    harness.payloads.set("m1", {
      content: "https://example.com/a",
      type: "text",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const before = await page("link");
    expect(before.items).toHaveLength(1);

    harness.payloads.set("m1", { content: "no links now", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const after = await page("link");
    expect(after.items).toEqual([]);
    const counts = await harness.store.readSharedRefsCounts(CONVO);
    expect(counts?.link).toBe(0);
  });

  test("a message that becomes empty loses its refs", async () => {
    harness.payloads.set("m1", {
      content: "https://example.com/a",
      type: "text",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();

    harness.payloads.set("m1", { content: "   ", type: "text" });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const after = await page("link");
    expect(after.items).toEqual([]);
  });

  test("remove() drops refs as well as text rows", async () => {
    harness.payloads.set("m1", {
      content: "https://example.com/a",
      type: "text",
    });
    harness.payloads.set("m2", {
      content: "https://example.com/b",
      type: "text",
    });
    harness.writer.consider([message("m1"), message("m2")]);
    await harness.writer.flush();
    const before = await page("link");
    expect(before.items).toHaveLength(2);

    // The same call the thread makes for delete-for-me and for a
    // delete-for-everyone event: leaving refs behind would show hidden text in the
    // one place the user goes looking for the conversation's contents.
    harness.writer.remove(["m1"]);
    await harness.writer.flush();
    const after = await page("link");
    expect(after.items.map((item) => item.messageId)).toEqual(["m2"]);
  });

  test("a message deleted while queued never gets a ref row", async () => {
    harness.payloads.set("m1", {
      content: "https://example.com/a",
      type: "text",
    });
    harness.writer.consider([message("m1")]);
    harness.writer.remove(["m1"]);
    await harness.writer.flush();
    const after = await page("link");
    expect(after.items).toEqual([]);
  });

  test("an undecryptable row is queued, not stored as an empty ref", async () => {
    harness.payloads.set("m1", "pending");
    harness.writer.consider([message("m1")]);
    const flushed = await harness.writer.flush();
    expect(flushed.stillPending).toEqual(["m1"]);
    const empty = await page("link");
    expect(empty.items).toEqual([]);
    expect(await harness.store.readSharedRefsCounts(CONVO)).toBeNull();

    // And it lands once the payload arrives, which is the durable-queue contract.
    harness.payloads.set("m1", {
      content: "https://example.com/a",
      type: "text",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const landed = await page("link");
    expect(landed.items).toHaveLength(1);
  });

  test("a re-consider with unchanged refs writes nothing new", async () => {
    harness.payloads.set("m1", {
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const before = await page("media");

    // The transcript re-consideres on every decrypt tick; without a refs-aware
    // signature this would rewrite the row on each one, for nothing.
    harness.writer.consider([message("m1")]);
    await harness.writer.flush();
    const after = await page("media");
    expect(after.items[0]).toBe(before.items[0]);
    const counts = await harness.store.readSharedRefsCounts(CONVO);
    expect(counts?.media).toBe(1);
  });

  test("a refs write failure leaves the text index intact and retries later", async () => {
    // The two writes are separate transactions on purpose: search must not go down
    // with refs. The failure is injected directly, because inducing a real
    // IndexedDB rejection here would mean faulting the browser.
    const failing = createMemorySearchIndexStore();
    let failNext = true;
    let textWrites = 0;
    const spy = {
      ...failing,
      putEntries: (
        ...args: Parameters<typeof failing.putEntries>
      ): Promise<void> => {
        textWrites += 1;
        return failing.putEntries(...args);
      },
      putSharedRefs: (
        ...args: Parameters<typeof failing.putSharedRefs>
      ): Promise<void> => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("refs unavailable"));
        }
        return failing.putSharedRefs(...args);
      },
    };
    const payloads = new Map<string, IndexablePayload>([
      ["m1", { content: "https://example.com/a", type: "text" }],
    ]);
    let notify: (() => void) | null = null;
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store: spy,
      subscribeToPayloads: (listener) => {
        notify = listener;
        return () => {
          notify = null;
        };
      },
    });
    writer.consider([message("m1")]);
    const failed = await writer.flush();

    // Text committed; refs did not, and the row is queued rather than dropped.
    expect(failed.stillPending).toEqual(["m1"]);
    expect(await idsFor(failing, "https://example.com/a")).toEqual(["m1"]);
    const hole = await failing.readSharedRefs(CONVO, "link", { limit: 10 });
    expect(hole.items).toEqual([]);

    // And the retry lands it. This is the part the two-half signature exists for:
    // the text half was already current, so a combined signature would have
    // skipped this pass and left the hole open for good.
    notify?.();
    await writer.flush();
    const filled = await failing.readSharedRefs(CONVO, "link", { limit: 10 });
    expect(filled.items).toHaveLength(1);
    expect(textWrites).toBe(1);
  });
});
