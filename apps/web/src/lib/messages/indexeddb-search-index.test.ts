// Covers the IndexedDB backend against a real IndexedDB implementation.
//
// This file is separate from search-index-format.test.ts on purpose: that suite
// asserts the *fallback* path, which requires IndexedDB to be absent, and
// importing the shim here would make that global present for both files. The
// shim is imported at the top of this file only.
//
// The behaviours worth testing are the ones the in-memory reference cannot
// demonstrate: that data survives a new store instance, that a pre-sealed-layout
// database is reset rather than misread, that a query resolves only its own rows, and -- the
// reason this backend exists at all -- that nothing readable is left on disk.
import "fake-indexeddb/auto";
// The promises in this file are IndexedDB's event-based lifecycle, which has no
// async/await form.
// oxlint-disable promise/avoid-new -- IndexedDB request and open lifecycles are event-based
import { beforeEach, describe, expect, test } from "bun:test";

import { deriveIndexKeyFromBase } from "./crypto";
import {
  createIndexedDbSearchIndexStore,
  resetIndexedDbSearchIndexStoreForTests,
} from "./indexeddb-search-index";
import type { SearchIndexKeyResolver } from "./indexeddb-search-index";
import { MESSAGES_DB_VERSION } from "./message-db";
import {
  buildSearchIndexEntry,
  emptySearchIndexMeta,
  SEARCH_INDEX_FORMAT_VERSION,
} from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";
import { seal } from "./search-index-vault";

const DB_NAME = "asm-messages";
const TABLES_STORE = "search-tables";
const POSTINGS_STORE = "search-postings";
const ALLOC_STORE = "search-alloc";
const META_STORE = "search-meta";
const PENDING_STORE = "search-pending";

// A real AES-GCM index key, derived the way the app derives it. Tests use the
// real thing rather than a stand-in so a change that weakened the derivation
// (a reused salt, a dropped AAD binding) would fail here.
let testMasterKey: CryptoKey | null = null;

async function testIndexKey(conversationId: string): Promise<CryptoKey> {
  if (!testMasterKey) {
    const raw = new Uint8Array(32).fill(7);
    testMasterKey = await globalThis.crypto.subtle.importKey(
      "raw",
      raw,
      "HKDF",
      false,
      ["deriveKey"]
    );
  }
  return deriveIndexKeyFromBase(await testMasterKey, conversationId);
}

// The resolver the app supplies. `generation` is a module-level value so a test
// can simulate a root rotation without rebuilding the key.
//
// The conversation id is the one the STORE passes in, not one captured when the
// resolver was built. Capturing it would derive every conversation's index from
// the same key, which would quietly stop the suite from testing the per-conversation
// key separation that is the whole point of sealing.
let currentGeneration = "gen-1";

function testResolver(): SearchIndexKeyResolver {
  return async (conversationId) => ({
    generation: currentGeneration,
    key: await testIndexKey(conversationId),
  });
}

function createTestStore(): SearchIndexStore {
  return createIndexedDbSearchIndexStore({ resolveKey: testResolver() });
}

// Posting lists keyed by token TEXT, resolved back through the table's
// dictionary. This helper deliberately uses readAllPostingLists so tests can
// inspect one stored list in isolation; the production keystroke path below
// always goes through query.
async function postingList(
  store: SearchIndexStore,
  conversationId: string,
  token: string
): Promise<Uint32Array> {
  const all = await store.readAllPostingLists(conversationId);
  return all.get(token) ?? new Uint32Array(0);
}

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

// The production keystroke path: store.query owns the dictionary lookup,
// checked posting-list snapshot, intersection, and row projection together.
async function queryStore(
  store: SearchIndexStore,
  conversationId: string,
  tokens: string[]
): Promise<{ ids: string[]; totalMatched: number }> {
  const result = await store.query(conversationId, tokens, 1000);
  return {
    ids: [...result.rows.values()]
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .map((facts) => facts.messageId),
    totalMatched: result.totalMatched,
  };
}

// Runs one raw IndexedDB request against the real database, so a test can read or
// plant a record the store itself would never write.
//
// Two rules, both learned the hard way:
//
//   - The request must be ISSUED INSIDE `issue`, not after this returns. An
//     IndexedDB transaction commits as soon as its request queue drains, and
//     awaiting here would hand back a store whose transaction is already finished.
//   - The open must request the SHARED version. A bare `indexedDB.open(name)` on a
//     database that does not exist yet creates it at version 1 with no object
//     stores, and the `db.transaction([storeName], ...)` below then throws
//     NotFoundError from inside an event listener. fake-indexeddb reports that as
//     an AggregateError and the promise never settles, so the test fails and then
//     leaves a v1 connection open that blocks every later version upgrade.
function rawRequestIn(
  storeName: string,
  mode: IDBTransactionMode,
  issue: (store: IDBObjectStore) => IDBRequest<never> | IDBRequest<unknown>
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, MESSAGES_DB_VERSION);
    open.addEventListener("success", () => {
      const db = open.result;
      // Closed on every exit path. A leaked connection is not a local annoyance:
      // it blocks `deleteDatabase` and every later version upgrade, so its effect
      // is a timeout in an unrelated test.
      const close = (value?: unknown) => {
        db.close();
        if (value === undefined) {
          resolve();
        } else {
          resolve(value);
        }
      };
      db.onversionchange = close;
      let tx: IDBTransaction;
      try {
        tx = db.transaction([storeName], mode);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      let result: unknown;
      try {
        const request = issue(tx.objectStore(storeName));
        request.addEventListener("success", () => {
          ({ result } = request);
        });
        request.addEventListener("error", () => {
          db.close();
          reject(request.error);
        });
        // Resolved on COMMIT, not on request success: a write's request succeeds
        // before the transaction commits, and returning early would let the next
        // test's `deleteDatabase` skip.
        tx.addEventListener("complete", () => close(result));
        tx.addEventListener("abort", () => {
          db.close();
          reject(tx.error);
        });
      } catch (error) {
        db.close();
        reject(error);
      }
    });
    open.addEventListener("error", () => reject(open.error));
    open.addEventListener("blocked", () =>
      reject(new Error("raw IndexedDB open blocked"))
    );
  });
}

function readRaw(storeName: string, key: IDBValidKey): Promise<unknown> {
  return rawRequestIn(storeName, "readonly", (store) => store.get(key));
}

function writeRaw(
  storeName: string,
  key: IDBValidKey,
  value: unknown
): Promise<unknown> {
  return rawRequestIn(storeName, "readwrite", (store) => store.put(value, key));
}

function rawKeys(storeName: string): Promise<unknown> {
  return rawRequestIn(storeName, "readonly", (store) => store.getAllKeys());
}

function rawField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return value[key];
}

// Opens a connection for schema assertions. Requests the shared version so it can
// never be the thing that creates a store-less v1 database, and hands back a
// handle the caller must close.
function openRawForInspection(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, MESSAGES_DB_VERSION);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("raw IndexedDB inspection open blocked"))
    );
  });
}

describe("indexeddb search index store", () => {
  let store: SearchIndexStore;

  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
    store = createTestStore();
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

  test("a stale writer retries after clear and recreate", async () => {
    await store.putEntries("c1", new Map([["m1", entry("old", 1)]]));
    const keyReleased = Promise.withResolvers<undefined>();
    const keyStarted = Promise.withResolvers<undefined>();
    let firstResolution = true;
    const normalResolver = testResolver();
    const gatedStore = createIndexedDbSearchIndexStore({
      resolveKey: async (conversationId) => {
        if (firstResolution) {
          firstResolution = false;
          keyStarted.resolve();
          await keyReleased.promise;
        }
        return normalResolver(conversationId);
      },
    });

    const pending = gatedStore.putEntries(
      "c1",
      new Map([["m-stale", entry("stale", 2)]])
    );
    await keyStarted.promise;
    await store.clearConversation("c1");
    await store.putEntries("c1", new Map([["m-new", entry("fresh", 3)]]));
    keyReleased.resolve();
    await pending;

    const freshResult = await store.query("c1", ["fresh"], 10);
    const staleResult = await store.query("c1", ["stale"], 10);
    expect(freshResult.totalMatched).toBe(1);
    expect(staleResult.totalMatched).toBe(1);
  });

  // The whole point of the backend: a fresh store instance sees prior writes.
  test("data survives a new store instance", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const reopened = createTestStore();
    const found = await queryStore(reopened, "c1", ["deploy"]);
    expect(found.ids).toEqual(["m1"]);
  });

  test("a query retries when the table changes before its posting snapshot", async () => {
    await store.putEntries("c1", new Map([["m1", entry("old", 1)]]));
    const keyReleased = Promise.withResolvers<undefined>();
    const keyStarted = Promise.withResolvers<undefined>();
    let firstResolution = true;
    const normalResolver = testResolver();
    const gatedStore = createIndexedDbSearchIndexStore({
      resolveKey: async (conversationId) => {
        if (firstResolution) {
          firstResolution = false;
          keyStarted.resolve();
          await keyReleased.promise;
        }
        return normalResolver(conversationId);
      },
    });

    const pending = gatedStore.query("c1", ["old"], 10);
    await keyStarted.promise;
    await store.clearConversation("c1");
    await store.putEntries("c1", new Map([["m-new", entry("fresh", 2)]]));
    keyReleased.resolve();
    const result = await pending;

    expect(result.totalMatched).toBe(0);
    expect(result.rows.size).toBe(0);
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
    const list = await postingList(store, "c1", "deploy");
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
    const alpha = await postingList(store, "c1", "alpha");
    const beta = await postingList(store, "c1", "beta");
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
    const one = await postingList(store, "c1", "alpha");
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

  test("re-indexing a removed message leaves postings and totals unchanged", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.removeEntries("c1", ["m1"]);
    const before = await queryStore(store, "c1", ["deploy"]);
    const beforeLists = await store.readAllPostingLists("c1");

    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));

    const after = await queryStore(store, "c1", ["deploy"]);
    const afterLists = await store.readAllPostingLists("c1");
    expect(after).toEqual(before);
    expect([...afterLists]).toEqual([...beforeLists]);
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
    const beta = await postingList(store, "c1", "beta");
    expect([...beta]).toEqual([1]);
    const alpha = await postingList(store, "c1", "alpha");
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
    const alpha = await postingList(store, "c1", "alpha");
    const beta = await postingList(store, "c1", "beta");
    expect([...alpha]).toEqual([0]);
    expect([...beta]).toEqual([1]);
  });

  test("row numbering survives a new store instance", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    const reopened = createTestStore();
    await reopened.putEntries("c1", new Map([["m2", entry("beta", 2)]]));
    const beta = await postingList(reopened, "c1", "beta");
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
    const list = await postingList(store, "c1", "deploy");
    list[0] = 999;
    const reread = await postingList(store, "c1", "deploy");
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
    const store = createTestStore();
    await store.readMeta("c1");
    const db = await openRawForInspection();
    try {
      expect(db.version).toBe(MESSAGES_DB_VERSION);
      for (const name of [
        TABLES_STORE,
        POSTINGS_STORE,
        ALLOC_STORE,
        META_STORE,
        PENDING_STORE,
      ]) {
        expect(db.objectStoreNames.contains(name)).toBe(true);
      }
      // The v5 per-row stores must not survive, or the disk cost of the index
      // would keep growing alongside the sealed table.
      for (const name of ["search-entries", "search-rows", "search-row-ids"]) {
        expect(db.objectStoreNames.contains(name)).toBe(false);
      }
    } finally {
      // A leaked connection blocks every later version upgrade, which shows up
      // as an unrelated timeout rather than as this test failing.
      db.close();
    }
  });

  // v5 stored one plaintext record per row. A sealed table cannot be built over
  // those, and keeping them would double the disk cost of the index, so the
  // obsolete stores are dropped. An empty index that re-walks is the honest
  // outcome: rebuilds are already the recovery path for a lost key.
  test("a pre-sealed-layout database drops its obsolete stores rather than misread them", async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open(DB_NAME, 5);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        for (const name of [
          "search-rows",
          "search-row-ids",
          POSTINGS_STORE,
          META_STORE,
        ]) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      });
      request.addEventListener("success", () => {
        const db = request.result;
        // A v5 plaintext row, which the sealed layout cannot interpret.
        const tx = db.transaction(["search-rows"], "readwrite");
        tx.objectStore("search-rows").put(
          {
            createdAt: 1,
            messageId: "m1",
            row: 0,
            senderId: "u",
            tokens: ["ghost"],
            version: 5,
          },
          ["c1", "0"]
        );
        tx.addEventListener("complete", () => {
          db.close();
          resolve();
        });
      });
    });

    const store = createTestStore();
    // The first store call is what triggers the upgrade, so the version has to be
    // read after it, not before.
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);

    const db = await openRawForInspection();
    try {
      expect(db.version).toBe(MESSAGES_DB_VERSION);
      expect(db.objectStoreNames.contains("search-rows")).toBe(false);
      expect(db.objectStoreNames.contains("search-row-ids")).toBe(false);
      expect(db.objectStoreNames.contains(TABLES_STORE)).toBe(true);
    } finally {
      // A leaked connection blocks every later version upgrade, which shows up
      // as an unrelated timeout rather than as this test failing.
      db.close();
    }

    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    expect(resolved.size).toBe(0);
  });

  // The security regression this whole reset exists for. Before sealing, a posting
  // list was keyed `[conversationId, tokenText]`, so the words a user searched for
  // sat in PLAINTEXT in an IndexedDB key. `search-postings` is still a current
  // store name, so deleting the obsolete per-row stores is NOT enough: the upgrade
  // has to drop the current-name search stores too, or those plaintext keys survive
  // and the seal protects nothing on disk.
  //
  // Identity material is in the same database and must survive the rebuild: losing
  // it would be a total loss, not a degraded index.
  test("an upgrade drops old token-text postings but keeps identity material", async () => {
    const IDENTITY_STORE_NAME = "identity-keys";
    const SENTINEL = "identity-must-survive";
    // One below the current version: the previously shipped layout, whose
    // `search-postings` keys were token text rather than token ids.
    const previousVersion = MESSAGES_DB_VERSION - 1;
    await new Promise<void>((resolve) => {
      const request = indexedDB.open(DB_NAME, previousVersion);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        for (const name of [
          IDENTITY_STORE_NAME,
          POSTINGS_STORE,
          TABLES_STORE,
          ALLOC_STORE,
          META_STORE,
        ]) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      });
      request.addEventListener("success", () => {
        const db = request.result;
        const tx = db.transaction(
          [IDENTITY_STORE_NAME, POSTINGS_STORE, META_STORE],
          "readwrite"
        );
        tx.objectStore(IDENTITY_STORE_NAME).put(SENTINEL, "me");
        // The old keying: the token itself is the second key component.
        tx.objectStore(POSTINGS_STORE).put(new Uint32Array([0]), [
          "c1",
          "supersecretword",
        ]);
        tx.objectStore(META_STORE).put(
          {
            conversationId: "c1",
            indexedThroughId: "m-stale",
            lastAccessedAt: 0,
            pendingIds: [],
            updatedAt: 0,
            version: 1,
          },
          "c1"
        );
        tx.addEventListener("complete", () => {
          db.close();
          resolve();
        });
        tx.addEventListener("abort", () => resolve());
      });
      request.addEventListener("error", () => resolve());
    });

    // Any store call triggers the upgrade.
    const store = createTestStore();
    await store.readMeta("c1");

    const postingKeys = (await rawKeys(POSTINGS_STORE)) as IDBValidKey[];
    // The plaintext token is gone, and so is the whole old keying.
    expect(postingKeys.map(String).join("|")).not.toContain("supersecretword");
    expect(postingKeys.length).toBe(0);
    // Identity survived the rebuild untouched.
    expect(await readRaw(IDENTITY_STORE_NAME, "me")).toBe(SENTINEL);
    // Coverage does not claim history that was just discarded. The store is
    // dropped and recreated empty, so there is no record at all rather than a
    // record whose cursor points into a table that no longer exists.
    expect(await store.readMeta("c1")).toBeNull();
  });

  test("a table from another format version is ignored rather than misread", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await writeRaw(TABLES_STORE, "c1", {
      generation: currentGeneration,
      revision: 1,
      sealed: new Uint8Array([1, 2, 3]),
      version: 1,
    });
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    // The unreadable one is skipped rather than projected as a real row.
    expect(resolved.size).toBe(0);
  });

  test("an authentic malformed table is reset before a rebuild", async () => {
    const store = createTestStore();
    await store.readMeta("c1");
    const sealed = await seal(await testIndexKey("c1"), new Uint8Array(16), {
      conversationId: "c1",
      keyGeneration: currentGeneration,
    });
    await writeRaw(TABLES_STORE, "c1", {
      generation: currentGeneration,
      instanceId: "malformed-instance",
      revision: 4,
      sealed,
      version: SEARCH_INDEX_FORMAT_VERSION,
    });
    await writeRaw(POSTINGS_STORE, ["c1", "t99"], new Uint32Array([99]));

    await store.putEntries("c1", new Map([["m2", entry("recovered", 2)]]));

    const recovered = await queryStore(store, "c1", ["recovered"]);
    expect(recovered.totalMatched).toBe(1);
    expect(await readRaw(POSTINGS_STORE, ["c1", "t99"])).toBeUndefined();
  });

  test("an unusable table is reset before a rebuild", async () => {
    const store = createTestStore();
    await store.writeMeta({
      ...emptySearchIndexMeta("c1"),
      indexedThroughId: "stale-cursor",
      lastAccessedAt: 123,
    });
    await store.writePending("c1", ["pending"]);
    await writeRaw(TABLES_STORE, "c1", {
      generation: currentGeneration,
      instanceId: "broken-instance",
      revision: 4,
      sealed: new Uint8Array([1, 2, 3]),
      version: SEARCH_INDEX_FORMAT_VERSION,
    });
    await writeRaw(POSTINGS_STORE, ["c1", "t99"], new Uint32Array([99]));
    await writeRaw(ALLOC_STORE, "c1", 99);

    await store.putEntries("c1", new Map([["m2", entry("recovered", 2)]]));

    const recovered = await store.query("c1", ["recovered"], 10);
    const stats = await store.readStats("c1");
    expect(recovered.totalMatched).toBe(1);
    expect(await readRaw(POSTINGS_STORE, ["c1", "t99"])).toBeUndefined();
    expect(stats.indexedRowCount).toBe(1);
    expect(await store.readPending("c1")).toEqual(["pending"]);
    const meta = await store.readMeta("c1");
    expect(meta?.indexedThroughId).toBeNull();
    expect(meta?.lastAccessedAt).toBe(0);
    expect(meta?.version).toBe(SEARCH_INDEX_FORMAT_VERSION);
  });

  test("removing an unusable table clears its data and resets coverage", async () => {
    const store = createTestStore();
    await store.writeMeta({
      ...emptySearchIndexMeta("c1"),
      indexedThroughId: "stale-cursor",
      lastAccessedAt: 123,
    });
    await store.writePending("c1", ["pending"]);
    await writeRaw(TABLES_STORE, "c1", {
      generation: currentGeneration,
      instanceId: "broken-instance",
      revision: 4,
      sealed: new Uint8Array([1, 2, 3]),
      version: SEARCH_INDEX_FORMAT_VERSION,
    });
    await writeRaw(POSTINGS_STORE, ["c1", "t99"], new Uint32Array([99]));
    await writeRaw(ALLOC_STORE, "c1", 99);

    await store.removeEntries("c1", ["m2"]);

    expect(await readRaw(TABLES_STORE, "c1")).toBeUndefined();
    expect(await readRaw(POSTINGS_STORE, ["c1", "t99"])).toBeUndefined();
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);
    expect(await store.readPending("c1")).toEqual(["pending"]);
    const meta = await store.readMeta("c1");
    expect(meta?.indexedThroughId).toBeNull();
    expect(meta?.lastAccessedAt).toBe(0);
    expect(meta?.version).toBe(SEARCH_INDEX_FORMAT_VERSION);
  });

  test("meta written by another format version reads as absent", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await writeRaw(META_STORE, "c1", {
      conversationId: "c1",
      indexedThroughId: "m999",
      pendingIds: [],
      updatedAt: 1,
      version: 1,
    });
    // Re-indexing from scratch is the correct response; trusting a shape this
    // build cannot read is not.
    expect(await store.readMeta("c1")).toBeNull();
  });

  test("writes stamp the current format version", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const stored = (await readRaw(TABLES_STORE, "c1")) as
      | { version: number }
      | undefined;
    expect(stored?.version).toBe(SEARCH_INDEX_FORMAT_VERSION);
  });

  test("each write advances the revision", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const first = (await readRaw(TABLES_STORE, "c1")) as
      | { revision: number }
      | undefined;
    await store.putEntries("c1", new Map([["m2", entry("rollback", 2)]]));
    const second = (await readRaw(TABLES_STORE, "c1")) as
      | { revision: number }
      | undefined;
    expect(second?.revision).toBe((first?.revision ?? 0) + 1);
  });

  test("the table instance token survives writes and changes after clear", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const firstToken = rawField(
      await readRaw(TABLES_STORE, "c1"),
      "instanceId"
    );
    expect(firstToken).toEqual(expect.any(String));

    await store.putEntries("c1", new Map([["m2", entry("rollback", 2)]]));
    expect(rawField(await readRaw(TABLES_STORE, "c1"), "instanceId")).toBe(
      firstToken
    );

    await store.clearConversation("c1");
    await store.putEntries("c1", new Map([["m3", entry("deploy", 3)]]));
    expect(rawField(await readRaw(TABLES_STORE, "c1"), "instanceId")).not.toBe(
      firstToken
    );
  });
});

describe("indexeddb sealing at rest", () => {
  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
    currentGeneration = "gen-1";
  });

  // The whole point of the sealed table. Without this, a stolen device database
  // is a transcript: the words and senders are enough to reconstruct the
  // conversation even though the message bodies are ciphertext.
  test("the stored table contains no message text, token, or sender", async () => {
    const store = createTestStore();
    await store.putEntries(
      "c1",
      new Map([["m1", entry("deploy rollback hunter2", 1, "user-z")]])
    );
    const record = (await readRaw(TABLES_STORE, "c1")) as
      | { sealed: Uint8Array }
      | undefined;
    const bytes = new TextDecoder("latin1").decode(
      record?.sealed ?? new Uint8Array(0)
    );
    for (const secret of ["deploy", "rollback", "hunter2", "user-z", "m1"]) {
      expect(bytes).not.toContain(secret);
    }
  });

  test("posting-list keys are token ids, not token text", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const keys = (await rawKeys(POSTINGS_STORE)) as IDBValidKey[];
    // "c1" is the conversation id, which is not a secret. The token is.
    expect(keys.map(String).join("|")).not.toContain("deploy");
    expect(keys.map(String).join("|")).toContain("t0");
  });

  test("the wrong conversation's key cannot open the table", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const other = createIndexedDbSearchIndexStore({
      resolveKey: async (conversationId) => {
        const raw = new Uint8Array(32).fill(9);
        const base = await globalThis.crypto.subtle.importKey(
          "raw",
          raw,
          "HKDF",
          false,
          ["deriveKey"]
        );
        return {
          generation: currentGeneration,
          key: await deriveIndexKeyFromBase(base, conversationId),
        };
      },
    });
    const resolved = await other.readRows("c1", Uint32Array.from([0]));
    expect(resolved.size).toBe(0);
  });

  // A rotated conversation root must not keep serving a table sealed under the
  // old one, and must not be readable at all until the index is rebuilt.
  test("a rotated root invalidates the table instead of serving it", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const before = await store.query("c1", ["deploy"], 100);
    expect(before.totalMatched).toBe(1);

    currentGeneration = "gen-2";
    const after = await store.query("c1", ["deploy"], 100);
    expect(after.totalMatched).toBe(0);
    const rows = await store.readRows("c1", Uint32Array.from([0]));
    expect(rows.size).toBe(0);
  });

  test("an unavailable key is not indexed rather than written in the clear", async () => {
    const store = createIndexedDbSearchIndexStore({
      resolveKey: () => Promise.resolve(null),
    });
    // Establishes the schema through the app's own open. A raw open would create
    // the database at the shared version with no object stores, because
    // `upgradeneeded` only runs for the opener that defines them -- which is
    // exactly the trap `message-db.test.ts` exists to guard.
    expect(await store.readMeta("c1")).toBeNull();
    const result = await store.query("c1", ["deploy"], 100);
    expect(result.totalMatched).toBe(0);
    await expect(
      store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]))
    ).rejects.toThrow(/key unavailable/);
    // Nothing sealed, and no plaintext left behind either.
    expect(await readRaw(TABLES_STORE, "c1")).toBeUndefined();
    expect(await readRaw(POSTINGS_STORE, ["c1", "t0"])).toBeUndefined();
  });

  test("a query for an unknown token matches nothing without touching rows", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const absent = await store.query("c1", ["absent"], 100);
    expect(absent.totalMatched).toBe(0);
    // The words are ANDed, so one unknown word must sink the whole query. Dropping
    // the unknown word would quietly turn this into a search for "deploy" and
    // return a false positive.
    const both = await store.query("c1", ["deploy", "absent"], 100);
    expect(both.totalMatched).toBe(0);
    expect(both.rows.size).toBe(0);
  });

  // Regression: a fresh table used to be a shallow copy of a shared constant, so
  // the second conversation's first write started from the first conversation's
  // rows. The symptom was a row count that grew without any message being added.
  test("a second conversation starts from an empty table", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c2", new Map([["m9", entry("deploy", 2)]]));
    const firstStats = await store.readStats("c1");
    const secondStats = await store.readStats("c2");
    expect(firstStats.indexedRowCount).toBe(1);
    expect(secondStats.indexedRowCount).toBe(1);
    // Each conversation's rows resolve to its own message, not a neighbour's.
    const first = await store.readRows("c1", Uint32Array.from([0, 1]));
    expect(first.get(0)?.messageId).toBe("m1");
    expect(first.has(1)).toBe(false);
    const second = await store.readRows("c2", Uint32Array.from([0, 1]));
    expect(second.get(0)?.messageId).toBe("m9");
    expect(second.has(1)).toBe(false);
  });

  test("a rewritten message does not inflate the conversation's row count", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("rollback", 1)]]));
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(1);
  });
});
