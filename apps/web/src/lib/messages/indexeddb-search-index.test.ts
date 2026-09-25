// Covers the IndexedDB backend against a real IndexedDB implementation.
//
// This file is separate from search-index-format.test.ts on purpose: that suite
// asserts the *fallback* path, which requires IndexedDB to be absent, and
// importing the shim here would make that global present for both files. The
// shim is imported at the top of this file only.
//
// The behaviours worth testing are the ones the in-memory reference cannot
// demonstrate: that data survives a new store instance, that a pre-v5 database is
// reset rather than misread, and that a query resolves only its own rows.
import "fake-indexeddb/auto";
// The promises in this file are IndexedDB's event-based lifecycle, which has no
// async/await form.
// oxlint-disable promise/avoid-new -- IndexedDB request and open lifecycles are event-based
import { beforeEach, describe, expect, test } from "bun:test";

import {
  createIndexedDbSearchIndexStore,
  resetIndexedDbSearchIndexStoreForTests,
} from "./indexeddb-search-index";
import {
  buildSearchIndexEntry,
  emptySearchIndexMeta,
  intersectPostingLists,
  SEARCH_INDEX_FORMAT_VERSION,
} from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";

const DB_NAME = "asm-messages";
const ROWS_STORE = "search-rows";
const ROW_IDS_STORE = "search-row-ids";
const POSTINGS_STORE = "search-postings";
const ALLOC_STORE = "search-alloc";
const META_STORE = "search-meta";

function entry(
  text: string,
  createdAt: number,
  senderId = "user-a"
): SearchIndexEntry {
  const built = buildSearchIndexEntry({ createdAt, senderId, text });
  if (!built) {
    throw new Error(`expected "${text}" to produce an entry`);
  }
  return built;
}

// Exactly the hook's read path: one posting list per token, intersect, then
// resolve only the rows that survived.
async function queryStore(
  store: SearchIndexStore,
  conversationId: string,
  tokens: string[]
): Promise<{ ids: string[]; totalMatched: number }> {
  const lists = await Promise.all(
    tokens.map((token) => store.readPostingList(conversationId, token))
  );
  const { rows, totalMatched } = intersectPostingLists(lists, 1000);
  const resolved = await store.readRows(conversationId, Uint32Array.from(rows));
  return {
    ids: [...resolved.values()]
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .map((facts) => facts.messageId),
    totalMatched,
  };
}

function rawRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

// Opens the database and hands back a connection for a direct read, so a test can
// plant a record the store itself would never write.
async function rawRead(
  storeName: string,
  mode: IDBTransactionMode
): Promise<IDBObjectStore> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open(DB_NAME);
    request.addEventListener("success", () => resolve(request.result));
  });
  const tx = db.transaction([storeName], mode);
  tx.addEventListener("complete", () => db.close());
  return tx.objectStore(storeName);
}

describe("indexeddb search index store", () => {
  let store: SearchIndexStore;

  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
    store = createIndexedDbSearchIndexStore();
  });

  test("round-trips a batch and answers a query", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deploy the database", 2)],
      ])
    );
    expect(await queryStore(store, "c1", ["database"])).toEqual({
      ids: ["m2"],
      totalMatched: 1,
    });
  });

  // The whole point of the backend: a fresh store instance sees prior writes.
  test("data survives a new store instance", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const reopened = createIndexedDbSearchIndexStore();
    const found = await queryStore(reopened, "c1", ["deploy"]);
    expect(found.ids).toEqual(["m1"]);
  });

  test("keeps conversations isolated", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c2", new Map([["m9", entry("deploy", 1)]]));
    const inOne = await queryStore(store, "c1", ["deploy"]);
    const inTwo = await queryStore(store, "c2", ["deploy"]);
    expect(inOne.ids).toEqual(["m1"]);
    expect(inTwo.ids).toEqual(["m9"]);
  });

  test("an empty batch is a no-op", async () => {
    await store.putEntries("c1", new Map());
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);
  });

  // The reverse index lives in the row record, so this exercises the path that
  // drops a stale token on rewrite.
  test("a rewrite replaces the old tokens instead of appending", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("rollback", 1)]]));
    expect(await queryStore(store, "c1", ["deploy"])).toEqual({
      ids: [],
      totalMatched: 0,
    });
    const afterRewrite = await queryStore(store, "c1", ["rollback"]);
    expect(afterRewrite.ids).toEqual(["m1"]);
  });

  test("re-indexing the same text does not duplicate the row", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy latency", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("deploy latency", 1)]]));
    const list = await store.readPostingList("c1", "deploy");
    expect([...list]).toEqual([0]);
  });

  test("a rewritten message keeps its original row id", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("rollback", 1)]]));
    // Still row 0. A second id would leave the posting lists with two entries for
    // one message.
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    expect(resolved.get(0)?.messageId).toBe("m1");
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(1);
  });

  test("a later batch continues the row numbering rather than restarting", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    await store.putEntries("c1", new Map([["m2", entry("beta", 2)]]));
    // Both tokens resolve through the same numbering, or a query would miss one.
    const alpha = await store.readPostingList("c1", "alpha");
    const beta = await store.readPostingList("c1", "beta");
    expect([...alpha]).toEqual([0]);
    expect([...beta]).toEqual([1]);
  });

  test("a single read returns one token, not the whole index", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("alpha beta", 1)],
        ["m2", entry("alpha", 2)],
      ])
    );
    const all = await store.readAllPostingLists("c1");
    const one = await store.readPostingList("c1", "alpha");
    expect(all.size).toBe(2);
    expect([...one].length).toBe(2);
  });

  // The read that replaced a full table scan. Bounded by the request, not by the
  // conversation, which is what makes search memory flat as a thread grows.
  test("readRows resolves only the requested rows", async () => {
    const batch = new Map<string, SearchIndexEntry>();
    for (let index = 0; index < 50; index += 1) {
      batch.set(`m${index}`, entry("deploy", index));
    }
    await store.putEntries("c1", batch);
    const resolved = await store.readRows("c1", Uint32Array.from([0, 7, 49]));
    expect(resolved.size).toBe(3);
    expect(resolved.get(7)?.messageId).toBe("m7");
    expect(resolved.get(7)?.createdAt).toBe(7);
  });

  test("readRows skips a row that does not exist", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    const resolved = await store.readRows("c1", Uint32Array.from([0, 999]));
    expect(resolved.size).toBe(1);
  });

  test("readRows with no ids does no work", async () => {
    const resolved = await store.readRows("c1", new Uint32Array(0));
    expect(resolved.size).toBe(0);
  });

  test("removal is reflected in later queries", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy", 1)],
        ["m2", entry("deploy", 2)],
      ])
    );
    await store.removeEntries("c1", ["m1"]);
    const afterRemove = await queryStore(store, "c1", ["deploy"]);
    expect(afterRemove.ids).toEqual(["m2"]);
  });

  test("removing a message drops the tokens only it had", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy latency", 1)],
        ["m2", entry("deploy", 2)],
      ])
    );
    await store.removeEntries("c1", ["m1"]);
    const all = await store.readAllPostingLists("c1");
    // The emptied token's record is deleted, not left as a zero-row list.
    expect([...all.keys()]).toEqual(["deploy"]);
  });

  test("a bulk removal rewrites each list once and drops every row", async () => {
    const batch = new Map<string, SearchIndexEntry>();
    for (let index = 0; index < 50; index += 1) {
      batch.set(`m${index}`, entry("deploy latency", index));
    }
    await store.putEntries("c1", batch);
    const ids = [...batch.keys()];
    await store.removeEntries("c1", ids.slice(0, 49));
    const survivor = await queryStore(store, "c1", ["deploy"]);
    expect(survivor.ids).toEqual(["m49"]);
  });

  test("removing an unknown id changes nothing", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.removeEntries("c1", ["nope"]);
    const survivor = await queryStore(store, "c1", ["deploy"]);
    expect(survivor.ids).toEqual(["m1"]);
  });

  test("an empty removal is a no-op", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.removeEntries("c1", []);
    const survivor = await queryStore(store, "c1", ["deploy"]);
    expect(survivor.ids).toEqual(["m1"]);
  });

  test("a removed row's id is not reused by a later write", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    await store.removeEntries("c1", ["m1"]);
    await store.putEntries("c1", new Map([["m2", entry("beta", 2)]]));
    // The allocator is monotonic, so m2 is row 1 and nothing points at the
    // vacated row 0.
    const beta = await store.readPostingList("c1", "beta");
    expect([...beta]).toEqual([1]);
    const alpha = await store.readPostingList("c1", "alpha");
    expect([...alpha]).toEqual([]);
  });

  test("clearing a conversation drops entries, meta, and the allocator", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.writeMeta(emptySearchIndexMeta("c1"));
    expect(await store.readMeta("c1")).not.toBeNull();
    await store.clearConversation("c1");
    expect(await store.readMeta("c1")).toBeNull();
    const all = await store.readAllPostingLists("c1");
    expect(all.size).toBe(0);
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);
  });

  test("clearing one conversation leaves the other alone", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c2", new Map([["m9", entry("deploy", 1)]]));
    await store.clearConversation("c1");
    const kept = await queryStore(store, "c2", ["deploy"]);
    expect(kept.ids).toEqual(["m9"]);
  });

  test("meta is stored by value, so a later mutation cannot corrupt it", async () => {
    const meta = { ...emptySearchIndexMeta("c1"), pendingIds: ["m1"] };
    await store.writeMeta(meta);
    meta.pendingIds.push("m2");
    const stored = await store.readMeta("c1");
    expect(stored?.pendingIds).toEqual(["m1"]);
  });

  test("meta round-trips its fields", async () => {
    await store.writeMeta({
      ...emptySearchIndexMeta("c1"),
      indexedThroughId: "m50",
      updatedAt: 1234,
    });
    const stored = await store.readMeta("c1");
    expect(stored?.indexedThroughId).toBe("m50");
    expect(stored?.updatedAt).toBe(1234);
  });

  // The allocator deliberately lives outside meta. The backfill rewrites meta on
  // every page, so sharing one object would let the two roll each other's state
  // back, and a rolled-back allocator hands two messages the same row id.
  test("a meta write does not disturb row numbering", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    // Exactly what the backfill does between pages.
    await store.writeMeta({
      ...emptySearchIndexMeta("c1"),
      indexedThroughId: "m1",
    });
    await store.putEntries("c1", new Map([["m2", entry("beta", 2)]]));
    const alpha = await store.readPostingList("c1", "alpha");
    const beta = await store.readPostingList("c1", "beta");
    expect([...alpha]).toEqual([0]);
    expect([...beta]).toEqual([1]);
  });

  test("row numbering survives a new store instance", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    const reopened = createIndexedDbSearchIndexStore();
    await reopened.putEntries("c1", new Map([["m2", entry("beta", 2)]]));
    const beta = await reopened.readPostingList("c1", "beta");
    expect([...beta]).toEqual([1]);
  });

  test("unknown conversation reads as empty, not an error", async () => {
    expect(await store.readMeta("nope")).toBeNull();
    expect(await queryStore(store, "nope", ["anything"])).toEqual({
      ids: [],
      totalMatched: 0,
    });
    const stats = await store.readStats("nope");
    expect(stats.indexedRowCount).toBe(0);
    const resolved = await store.readRows("nope", Uint32Array.from([0]));
    expect(resolved.size).toBe(0);
  });

  test("a read cannot mutate the stored list", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const list = await store.readPostingList("c1", "deploy");
    list[0] = 999;
    const reread = await store.readPostingList("c1", "deploy");
    expect([...reread]).toEqual([0]);
  });

  // Writes are linear (measured ~10k msgs/s in the shim). Whole-conversation
  // cursor reads are deliberately not asserted at scale: the shim's own cursor is
  // quadratic, so such a test would measure the shim rather than this code. The
  // query path no longer uses a cursor at all, which is the point of readRows.
  test("many messages index and query correctly across batches", async () => {
    const TOTAL = 600;
    // oxlint-disable no-await-in-loop -- batches must land one at a time
    for (let start = 0; start < TOTAL; start += 100) {
      const batch = new Map<string, SearchIndexEntry>();
      for (let offset = 0; offset < 100; offset += 1) {
        const index = start + offset;
        batch.set(`m${index}`, entry(`deploy note ${index % 7}`, index));
      }
      await store.putEntries("c1", batch);
    }
    // oxlint-enable no-await-in-loop
    const found = await queryStore(store, "c1", ["note"]);
    expect(found.totalMatched).toBe(TOTAL);
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(TOTAL);
    // The last row resolves, which means numbering stayed dense across batches.
    const last = await store.readRows("c1", Uint32Array.from([TOTAL - 1]));
    expect(last.get(TOTAL - 1)?.messageId).toBe(`m${TOTAL - 1}`);
  });
});

describe("indexeddb schema versioning", () => {
  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
  });

  test("creates every search store on a fresh database", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.readMeta("c1");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(DB_NAME);
      request.addEventListener("success", () => resolve(request.result));
    });
    expect(db.version).toBe(5);
    for (const name of [
      ROWS_STORE,
      ROW_IDS_STORE,
      POSTINGS_STORE,
      ALLOC_STORE,
      META_STORE,
    ]) {
      expect(db.objectStoreNames.contains(name)).toBe(true);
    }
    db.close();
  });

  // v3/v4 keyed rows by message id. Reading one under v5's row-id key would
  // return a message id where a row id is expected, so the stores are reset
  // rather than migrated. An empty index that re-walks is the honest outcome.
  test("a pre-v5 database is reset rather than misread", async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open(DB_NAME, 4);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        for (const name of [ROWS_STORE, POSTINGS_STORE, META_STORE]) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      });
      request.addEventListener("success", () => {
        const db = request.result;
        // A v4 row, keyed by MESSAGE id, which v5 would misread as a row id.
        const tx = db.transaction([ROWS_STORE], "readwrite");
        tx.objectStore(ROWS_STORE).put(
          {
            createdAt: 1,
            messageId: "m1",
            row: 0,
            senderId: "u",
            tokens: ["ghost"],
            version: 2,
          },
          ["c1", "m1"]
        );
        tx.addEventListener("complete", () => {
          db.close();
          resolve();
        });
      });
    });

    const store = createIndexedDbSearchIndexStore();
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    // The stale record is gone rather than returned as row 0.
    expect(resolved.size).toBe(0);
  });

  test("a row from another format version is ignored rather than misread", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const rows = await rawRead(ROWS_STORE, "readwrite");
    await rawRequest(
      rows.put(
        {
          createdAt: 9,
          messageId: "m-ghost",
          row: 77,
          senderId: "x",
          tokens: ["ghost"],
          version: 1,
        },
        ["c1", "77"]
      )
    );
    const resolved = await store.readRows("c1", Uint32Array.from([0, 77]));
    // The real row survives; the unreadable one is skipped.
    expect(resolved.get(0)?.messageId).toBe("m1");
    expect(resolved.has(77)).toBe(false);
  });

  test("meta written by another format version reads as absent", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const meta = await rawRead(META_STORE, "readwrite");
    await rawRequest(
      meta.put(
        {
          conversationId: "c1",
          indexedThroughId: "m999",
          pendingIds: [],
          updatedAt: 1,
          version: 1,
        },
        "c1"
      )
    );
    // Re-indexing from scratch is the correct response; trusting a shape this
    // build cannot read is not.
    expect(await store.readMeta("c1")).toBeNull();
  });

  test("writes stamp the current format version", async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const rows = await rawRead(ROWS_STORE, "readonly");
    const stored = await rawRequest<{ version: number } | undefined>(
      rows.get(["c1", "0"])
    );
    expect(stored?.version).toBe(SEARCH_INDEX_FORMAT_VERSION);
  });
});
