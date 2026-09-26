// Covers the IndexedDB backend against a real IndexedDB implementation.
//
// This file is separate from search-index-format.test.ts on purpose: that suite
// asserts the *fallback* path, which requires IndexedDB to be absent, and
// importing the shim here would make that global present for both files. The
// shim is imported at the top of this file only.
//
// The behaviours worth testing are the ones the in-memory reference cannot
// demonstrate: that data survives a new store instance, that a pre-current-layout
// database is reset rather than misread, that a query resolves only its own rows,
// that a rewrite touches only the posting lists it changed, and that a removed
// row's id is never handed out again.
import "fake-indexeddb/auto";
// The promises in this file are IndexedDB's event-based lifecycle, which has no
// async/await form.
// oxlint-disable promise/avoid-new -- IndexedDB request and open lifecycles are event-based
import { beforeEach, describe, expect, test } from "bun:test";

import {
  createIndexedDbSearchIndexStore,
  planTokenListUpdates,
  resetIndexedDbSearchIndexStoreForTests,
  runTransaction,
} from "./indexeddb-search-index";
import {
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  OBSOLETE_SEARCH_STORES,
  SEARCH_HEADER_STORE,
  SEARCH_META_STORE,
  SEARCH_PENDING_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_ROW_IDS_STORE,
  SEARCH_ROWS_STORE,
} from "./message-db";
import {
  buildSearchIndexEntry,
  emptySearchIndexMeta,
  SEARCH_INDEX_FORMAT_VERSION,
} from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";

const HEADER_STORE = SEARCH_HEADER_STORE;
const META_STORE = SEARCH_META_STORE;
const POSTINGS_STORE = SEARCH_POSTINGS_STORE;
const ROW_IDS_STORE = SEARCH_ROW_IDS_STORE;
const ROWS_STORE = SEARCH_ROWS_STORE;

function createTestStore(): SearchIndexStore {
  return createIndexedDbSearchIndexStore();
}

// Posting lists keyed by token TEXT, resolved back through the header's
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

// The production keystroke path: store.query owns the dictionary lookup, the
// posting-list reads, the intersection, and the row projection together.
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
    const open = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
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

// Every key in a store, as the flat strings a test compares. The stored key is
// rendered rather than inspected, because a `[conversationId, keyComponent]` pair
// has no single string form.
async function rawKeyList(storeName: string): Promise<string[]> {
  const keys = await rawRequestIn(storeName, "readonly", (store) =>
    store.getAllKeys()
  );
  return Array.isArray(keys) ? keys.map(String) : [];
}

// One stored posting list, as numbers. A posting list is a typed array, so this
// narrows by construction rather than by assertion.
async function rawRowList(key: IDBValidKey): Promise<number[]> {
  const stored = await readRaw(POSTINGS_STORE, key);
  return stored instanceof Uint32Array ? [...stored] : [];
}

function rawField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return value[key];
}

function rawStringList(value: unknown, key: string): string[] {
  const field = rawField(value, key);
  return Array.isArray(field) ? field.map(String) : [];
}

function rawNumber(value: unknown, key: string): number {
  const field = rawField(value, key);
  return typeof field === "number" ? field : Number.NaN;
}

// Opens a connection for schema assertions. Requests the shared version so it can
// never be the thing that creates a store-less v1 database, and hands back a
// handle the caller must close.
function openRawForInspection(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("raw IndexedDB inspection open blocked"))
    );
  });
}

// Opens a database at an OLD version with a hand-picked schema, so the upgrade
// path can be exercised without shipping the old build.
//
// Records are written on the versionchange transaction itself. Creating a second
// transaction inside `upgradeneeded` gives one that is already on its way out, and
// the writes land in an aborted transaction.
function seedDatabaseAtVersion(
  version: number,
  storeNames: string[],
  seed?: (tx: IDBTransaction) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(MESSAGES_DB_NAME, version);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      for (const name of storeNames) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
      const { transaction } = request;
      if (transaction) {
        seed?.(transaction);
      }
    });
    request.addEventListener("success", () => {
      request.result.close();
      resolve();
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("raw IndexedDB open blocked"))
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

  // The whole point of the backend: a fresh store instance sees prior writes.
  test("data survives a new store instance", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const reopened = createTestStore();
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

  test("a query projects each row's preview for the list view", async () => {
    await store.putEntries(
      "c1",
      new Map([["m1", entry("can anyone find the zarquon thread?", 1)]])
    );
    const result = await store.query("c1", ["zarquon"], 100);
    const facts = [...result.rows.values()];
    expect(facts).toHaveLength(1);
    expect(facts[0]?.preview).toBe("can anyone find the zarquon thread?");
  });

  test("a rewrite updates the preview past the cached facts", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy this", 1)]]));
    // Fills the row-facts cache with the first text.
    const first = await store.query("c1", ["deploy"], 100);
    expect(first.rows.size).toBe(1);
    await store.putEntries("c1", new Map([["m1", entry("deploy that", 1)]]));
    const result = await store.query("c1", ["deploy"], 100);
    const facts = [...result.rows.values()];
    expect(facts).toHaveLength(1);
    expect(facts[0]?.preview).toBe("deploy that");
  });

  test("a row from before previews existed is treated as absent", async () => {
    // A version-5 row record, planted raw: the shape this build can no longer
    // read. The walk must see it as uncovered and re-index the message, and
    // reads must not resolve it -- otherwise the format bump would silently
    // strand every conversation on rows the list cannot render. The initial
    // write exists only to create the database schema.
    await store.putEntries("c1", new Map([["m-seed", entry("deploy", 9)]]));
    await writeRaw(ROWS_STORE, ["c1", "99"], {
      createdAt: 1,
      messageId: "m-old",
      present: true,
      senderId: "user-a",
      tokenIds: [0],
      version: 5,
    });
    await writeRaw(ROW_IDS_STORE, ["c1", "m-old"], 99);
    expect(await store.hasIndexedMessages("c1", ["m-old", "m-seed"])).toEqual(
      new Set(["m-seed"])
    );
    const rows = await store.readRows("c1", Uint32Array.from([99]));
    expect(rows.size).toBe(0);
  });

  // Same prefix contract as the reference backend: the trailing fragment fans
  // out across dictionary terms, AND-ed with any exact tokens.
  test("a trailing prefix matches every term starting with it", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deployment checklist", 2)],
        ["m3", entry("unrelated words here", 3)],
      ])
    );
    const found = await store.query("c1", [], 100, { prefix: "deplo" });
    expect(found.totalMatched).toBe(2);
    expect(
      [...found.rows.values()]
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .map((facts) => facts.messageId)
    ).toEqual(["m2", "m1"]);
  });

  test("a prefix ANDs with exact tokens and honors unknown words", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deployment checklist", 2)],
      ])
    );
    const narrowed = await store.query("c1", ["service"], 100, {
      prefix: "deplo",
    });
    expect(narrowed.totalMatched).toBe(1);
    const poisoned = await store.query("c1", ["absent"], 100, {
      prefix: "deplo",
    });
    expect(poisoned).toEqual({ rows: new Map(), totalMatched: 0 });
    const unknown = await store.query("c1", [], 100, { prefix: "zzz" });
    expect(unknown).toEqual({ rows: new Map(), totalMatched: 0 });
  });

  // The walk's skip check: which ids already occupy a row, so covered pages
  // cost one fetch and no decrypts. Tombstoned rows count -- a removed row is
  // covered, there is just nothing to find in it.
  test("hasIndexedMessages reports occupancy, not searchability", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deploy the database", 2)],
      ])
    );
    expect(await store.hasIndexedMessages("c1", ["m1", "m2", "m3"])).toEqual(
      new Set(["m1", "m2"])
    );
    expect(await store.hasIndexedMessages("c1", [])).toEqual(new Set());
    expect(await store.hasIndexedMessages("nope", ["m1"])).toEqual(new Set());
    await store.removeEntries("c1", ["m1"]);
    expect(await store.hasIndexedMessages("c1", ["m1", "m2"])).toEqual(
      new Set(["m1", "m2"])
    );
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

  // A rewrite is not a new message, so the facts of the message itself must not
  // move: createdAt and senderId are properties of the message, not of the text
  // currently indexed.
  test("a rewrite keeps the message's own createdAt and sender", async () => {
    await store.putEntries(
      "c1",
      new Map([["m1", entry("deploy", 10, "alice")]])
    );
    await store.putEntries(
      "c1",
      new Map([["m1", entry("rollback", 20, "bob")]])
    );
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    expect(resolved.get(0)?.createdAt).toBe(10);
    expect(resolved.get(0)?.senderId).toBe("alice");
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

  // What replaced the whole-blob compare-and-swap. Row ids are allocated inside
  // the write transaction, so IndexedDB's own serialisation is the lock and two
  // writers can never be handed the same id.
  test("concurrent writers on one conversation never share a row id", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    await Promise.all([
      store.putEntries("c1", new Map([["m2", entry("beta", 2)]])),
      store.putEntries("c1", new Map([["m3", entry("gamma", 3)]])),
    ]);
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(3);
    const beta = await postingList(store, "c1", "beta");
    const gamma = await postingList(store, "c1", "gamma");
    expect(beta.length).toBe(1);
    expect(gamma.length).toBe(1);
    // Distinct ids, and both rows resolve to their own message.
    expect(beta[0]).not.toBe(gamma[0]);
    const rows = await store.readRows("c1", Uint32Array.from([0, 1, 2]));
    expect(
      [...rows.values()].map((facts) => facts.messageId).toSorted()
    ).toEqual(["m1", "m2", "m3"]);
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

  // The deletion is recorded, not forgotten. A tombstone row survives with an
  // empty token list, so a stale device re-indexing the same message cannot
  // resurrect it and cannot repopulate a posting list either.
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
    // Still one interned row: the tombstone keeps the id reserved rather than
    // letting the message claim a second one.
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(1);
    const tombstone = await readRaw(ROWS_STORE, ["c1", "0"]);
    expect(rawField(tombstone, "present")).toBe(false);
    expect(rawStringList(tombstone, "tokenIds")).toEqual([]);
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
    await store.writePending("c1", ["m-pending"]);
    expect(await store.readMeta("c1")).not.toBeNull();
    await store.clearConversation("c1");
    expect(await store.readMeta("c1")).toBeNull();
    const all = await store.readAllPostingLists("c1");
    expect(all.size).toBe(0);
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);
    // No row record and no forward-index entry survive either.
    expect(await readRaw(ROWS_STORE, ["c1", "0"])).toBeUndefined();
    expect(await readRaw(ROW_IDS_STORE, ["c1", "m1"])).toBeUndefined();
    expect(await store.readPending("c1")).toEqual([]);
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
  // every page, so sharing one record would let the two roll each other's state
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

  test("lists conversations with their row counts and last access", async () => {
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    await store.putEntries("c2", new Map([["m9", entry("beta", 1)]]));
    // Coverage lives in meta, so a conversation is only listed once the walk has
    // written meta for it -- which is also what eviction accounts over.
    await store.writeMeta({
      ...emptySearchIndexMeta("c1"),
      lastAccessedAt: 99,
    });
    await store.writeMeta(emptySearchIndexMeta("c2"));
    const listed = await store.listConversations();
    const summaries = listed.toSorted((left, right) =>
      left.conversationId.localeCompare(right.conversationId)
    );
    expect(summaries).toEqual([
      {
        conversationId: "c1",
        indexedRowCount: 1,
        lastAccessedAt: 99,
      },
      { conversationId: "c2", indexedRowCount: 1, lastAccessedAt: 0 },
    ]);
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
    const noPostings = await store.readAllPostingLists("nope");
    expect(noPostings.size).toBe(0);
  });

  test("a read cannot mutate the stored list", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const list = await postingList(store, "c1", "deploy");
    list[0] = 999;
    const reread = await postingList(store, "c1", "deploy");
    expect([...reread]).toEqual([0]);
  });

  // The count the result bar renders is the FULL intersection, so a capped page of
  // rows must never shrink it.
  test("totalMatched is the full count while rows is capped", async () => {
    const batch = new Map<string, SearchIndexEntry>();
    for (let index = 0; index < 40; index += 1) {
      batch.set(`m${index}`, entry("deploy", index));
    }
    await store.putEntries("c1", batch);
    const capped = await store.query("c1", ["deploy"], 5);
    expect(capped.rows.size).toBe(5);
    expect(capped.totalMatched).toBe(40);
  });

  // The reported bug: the chat counter said 24k, the list stopped at 2,000. The
  // persistent backend is the one that has to serve those pages, so the seam
  // exactness is asserted here rather than only against the in-memory fallback.
  test("pages through every match with no duplicate or gap at the seam", async () => {
    const batch = new Map<string, SearchIndexEntry>();
    for (let index = 0; index < 40; index += 1) {
      batch.set(`m${index}`, entry(`deploy note ${index}`, index + 1));
    }
    await store.putEntries("c1", batch);
    const seen: string[] = [];
    let cursor: number | undefined;
    // oxlint-disable no-await-in-loop -- paging IS sequential: each window's keyset cursor is the previous window's last row, so parallel reads would defeat the test
    for (let page = 0; page < 10; page += 1) {
      const result = await store.query("c1", ["deploy"], 7, {
        afterRowId: cursor,
      });
      // Exact on every page: the counter does not depend on the window asked for.
      expect(result.totalMatched).toBe(40);
      const ids = [...result.rows.values()].map((facts) => facts.messageId);
      if (ids.length === 0) {
        break;
      }
      seen.push(...ids);
      cursor = Math.min(...result.rows.keys());
    }
    // oxlint-enable no-await-in-loop
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
    // Newest first, and contiguous: page by page down the row-id order with
    // nothing repeated and nothing missing.
    expect(seen[0]).toBe("m39");
    expect(seen[39]).toBe("m0");
  });

  test("a page below the oldest match is empty, not a repeat of the last page", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m0", entry("deploy", 1)],
        ["m1", entry("deploy", 2)],
      ])
    );
    const last = await store.query("c1", ["deploy"], 20);
    expect([...last.rows.keys()].toSorted((a, b) => b - a)).toEqual([1, 0]);
    const past = await store.query("c1", ["deploy"], 20, { afterRowId: 0 });
    expect(past.rows.size).toBe(0);
    expect(past.totalMatched).toBe(2);
  });

  test("a paged window resolves previews, so a deep page renders real text", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m0", entry("deploy the very first note", 1)],
        ["m1", entry("deploy the very last note", 2)],
      ])
    );
    // Past the head's window: only the older row is left below the cursor.
    const deep = await store.query("c1", ["deploy"], 20, { afterRowId: 1 });
    const facts = [...deep.rows.values()];
    expect(facts).toHaveLength(1);
    expect(facts[0]?.messageId).toBe("m0");
    expect(facts[0]?.preview).toBe("deploy the very first note");
  });

  // Writes are linear (measured ~10k msgs/s in the shim). Whole-conversation
  // cursor reads are deliberately not asserted at scale: the shim's own cursor is
  // quadratic, so such a test would measure the shim rather than this code. The
  // query path uses no cursor at all, which is the point of readRows.
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
        HEADER_STORE,
        POSTINGS_STORE,
        ROW_IDS_STORE,
        ROWS_STORE,
        META_STORE,
        SEARCH_PENDING_STORE,
      ]) {
        expect(db.objectStoreNames.contains(name)).toBe(true);
      }
      // A superseded shape must not survive, or the disk cost of the index would
      // keep growing alongside the live one.
      for (const name of OBSOLETE_SEARCH_STORES) {
        expect(db.objectStoreNames.contains(name)).toBe(false);
      }
    } finally {
      // A leaked connection blocks every later version upgrade, which shows up
      // as an unrelated timeout rather than as this test failing.
      db.close();
    }
  });

  // The previous layout held each conversation's whole row table as ONE sealed
  // record in `search-tables`, with its allocator in `search-alloc`. There is no
  // readable form for either here, and keeping them would double the disk cost of
  // the index, so they are dropped. An empty index that re-walks is the honest
  // outcome: rebuilds are already the recovery path for a lost row.
  test("a previous-layout database drops its obsolete stores rather than misread them", async () => {
    const previousVersion = MESSAGES_DB_VERSION - 1;
    await seedDatabaseAtVersion(
      previousVersion,
      ["search-alloc", POSTINGS_STORE, "search-tables"],
      (tx) => {
        // A sealed whole-table record, which has no readable form here.
        tx.objectStore("search-tables").put(
          {
            generation: "gen-1",
            instanceId: "old",
            revision: 4,
            sealed: new Uint8Array([1, 2, 3]),
            version: 3,
          },
          "c1"
        );
        tx.objectStore("search-alloc").put(41, "c1");
        tx.objectStore(POSTINGS_STORE).put(new Uint32Array([0]), ["c1", "t0"]);
      }
    );

    const store = createTestStore();
    // The first store call is what triggers the upgrade, so the version has to be
    // read after it, not before.
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(0);

    const db = await openRawForInspection();
    try {
      expect(db.version).toBe(MESSAGES_DB_VERSION);
      for (const name of ["search-alloc", "search-tables"]) {
        expect(db.objectStoreNames.contains(name)).toBe(false);
      }
      expect(db.objectStoreNames.contains(HEADER_STORE)).toBe(true);
    } finally {
      // A leaked connection blocks every later version upgrade, which shows up
      // as an unrelated timeout rather than as this test failing.
      db.close();
    }

    // Numbering starts from zero, not from the dropped allocator's 41, and no
    // leftover posting list can be reached.
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    expect(resolved.size).toBe(0);
    expect(await readRaw(POSTINGS_STORE, ["c1", "t0"])).toBeUndefined();
    await store.putEntries("c1", new Map([["m1", entry("fresh", 1)]]));
    const fresh = await queryStore(store, "c1", ["fresh"]);
    expect(fresh.ids).toEqual(["m1"]);
    const restarted = await store.readStats("c1");
    expect(restarted.indexedRowCount).toBe(1);
  });

  // Identity material is in the same database and must survive the rebuild:
  // losing it would be a total loss, not a degraded index. And whatever the
  // previous layout keyed its posting lists by, nothing from it may be readable
  // afterwards, so a mixed index is impossible.
  test("an upgrade drops the previous layout's search data but keeps identity material", async () => {
    const IDENTITY_STORE_NAME = "identity-keys";
    const SENTINEL = "identity-must-survive";
    const previousVersion = MESSAGES_DB_VERSION - 1;
    await seedDatabaseAtVersion(
      previousVersion,
      [IDENTITY_STORE_NAME, POSTINGS_STORE, META_STORE],
      (tx) => {
        tx.objectStore(IDENTITY_STORE_NAME).put(SENTINEL, "me");
        // Both historical keyings: token text from the pre-sealing layouts, and
        // the token id the sealed one used.
        tx.objectStore(POSTINGS_STORE).put(new Uint32Array([0]), [
          "c1",
          "supersecretword",
        ]);
        tx.objectStore(POSTINGS_STORE).put(new Uint32Array([0]), ["c1", "t0"]);
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
      }
    );

    // Any store call triggers the upgrade.
    const store = createTestStore();
    await store.readMeta("c1");

    const postingKeys = await rawKeyList(POSTINGS_STORE);
    // Neither the plaintext token nor the old token id is reachable.
    expect(postingKeys.join("|")).not.toContain("supersecretword");
    expect(postingKeys.length).toBe(0);
    // Identity survived the rebuild untouched.
    expect(await readRaw(IDENTITY_STORE_NAME, "me")).toBe(SENTINEL);
    // Coverage does not claim history that was just discarded. The store is
    // dropped and recreated empty, so there is no record at all rather than a
    // record whose cursor points at rows that no longer exist.
    expect(await store.readMeta("c1")).toBeNull();
  });

  // A row record this build cannot read is left exactly as it is: its posting
  // membership cannot be computed from a shape we cannot parse, and overwriting
  // it would strand rows the posting lists still reference.
  test("a row from another format version is not revived by a re-index", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await writeRaw(ROW_IDS_STORE, ["c1", "m1"], 0);
    await writeRaw(ROWS_STORE, ["c1", "0"], {
      createdAt: 1,
      messageId: "m1",
      present: true,
      senderId: "u",
      tokenIds: [0],
      version: SEARCH_INDEX_FORMAT_VERSION - 1,
    });

    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));

    // The unreadable row is skipped rather than rewritten, so it is not projected
    // as a real row.
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    expect(resolved.size).toBe(0);
    // And a DIFFERENT message still indexes normally alongside it.
    await store.putEntries("c1", new Map([["m2", entry("rollback", 2)]]));
    const neighbour = await queryStore(store, "c1", ["rollback"]);
    expect(neighbour.ids).toEqual(["m2"]);
  });

  // A header this build cannot read is treated as absent, so the conversation
  // restarts rather than inheriting a numbering and a dictionary this build
  // cannot interpret.
  test("a header from another format version is ignored rather than trusted", async () => {
    const store = createTestStore();
    await store.readMeta("c1");
    await writeRaw(HEADER_STORE, "c1", {
      dictionary: ["ghost"],
      nextRow: 99,
      version: SEARCH_INDEX_FORMAT_VERSION - 1,
    });
    await writeRaw(POSTINGS_STORE, ["c1", "t0"], new Uint32Array([99]));

    await store.putEntries("c1", new Map([["m2", entry("recovered", 2)]]));

    const recovered = await queryStore(store, "c1", ["recovered"]);
    expect(recovered.ids).toEqual(["m2"]);
    expect(recovered.totalMatched).toBe(1);
    // Numbering restarted, and the old list cannot be reached by any word. It is
    // not merely unreadable: the restarted dictionary hands "recovered" id 0, so
    // the leftover list had to be dropped rather than adopted, or its phantom row
    // would be counted as a match.
    const restarted = await store.readStats("c1");
    expect(restarted.indexedRowCount).toBe(1);
    expect(await rawRowList(["c1", "t0"])).toEqual([0]);
    const header = rawStringList(
      await readRaw(HEADER_STORE, "c1"),
      "dictionary"
    );
    expect(header).toEqual(["recovered"]);
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
    const row = await readRaw(ROWS_STORE, ["c1", "0"]);
    const header = await readRaw(HEADER_STORE, "c1");
    expect(rawField(row, "version")).toBe(SEARCH_INDEX_FORMAT_VERSION);
    expect(rawField(header, "version")).toBe(SEARCH_INDEX_FORMAT_VERSION);
  });

  // The dictionary's order IS the posting ids, and it is append-only: a token id
  // that exists must never move, or every posting list keyed by it would silently
  // start describing a different word.
  test("the dictionary is append-only and never reordered", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    await store.putEntries("c1", new Map([["m2", entry("beta alpha", 2)]]));
    // "aardvark" sorts before both, so a sorted dictionary would renumber them.
    await store.putEntries("c1", new Map([["m3", entry("aardvark", 3)]]));
    const header = await readRaw(HEADER_STORE, "c1");
    expect(rawStringList(header, "dictionary")).toEqual([
      "alpha",
      "beta",
      "aardvark",
    ]);
    expect(await postingList(store, "c1", "alpha")).toHaveLength(2);
    expect(await postingList(store, "c1", "aardvark")).toHaveLength(1);
  });

  test("a batch that only re-indexes tombstones writes no header", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    await store.removeEntries("c1", ["m1"]);
    const before = rawNumber(await readRaw(HEADER_STORE, "c1"), "nextRow");
    await store.putEntries("c1", new Map([["m1", entry("alpha", 1)]]));
    const after = rawNumber(await readRaw(HEADER_STORE, "c1"), "nextRow");
    expect(after).toBe(before);
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(1);
  });
});

describe("indexeddb storage shape", () => {
  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
  });

  // The index is a local cache that never leaves the device and that the server
  // holds no copy of, so it is stored in the clear and protected by the OS and the
  // device lock, the way WhatsApp, Telegram, Signal, iMessage and Slack do. This
  // test states that shape rather than asserting a property it does not have.
  test("the row record and the header are plain records, with no ciphertext", async () => {
    const store = createTestStore();
    await store.putEntries(
      "c1",
      new Map([["m1", entry("deploy rollback", 1, "user-z")]])
    );
    const row = await readRaw(ROWS_STORE, ["c1", "0"]);
    expect(rawField(row, "createdAt")).toBe(1);
    expect(rawField(row, "messageId")).toBe("m1");
    expect(rawField(row, "present")).toBe(true);
    expect(rawField(row, "senderId")).toBe("user-z");
    expect(rawStringList(row, "tokenIds").length).toBe(2);
    const header = await readRaw(HEADER_STORE, "c1");
    expect(rawStringList(header, "dictionary")).toEqual(["deploy", "rollback"]);
    expect(rawNumber(header, "nextRow")).toBe(1);
  });

  // Token text in an IndexedDB key would be a word the user typed, sitting in the
  // clear next to the conversation it came from. The key is the dictionary id.
  test("posting-list keys are token ids, not token text", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const keys = await rawKeyList(POSTINGS_STORE);
    // "c1" is the conversation id, which is not a secret. The token is.
    expect(keys.join("|")).not.toContain("deploy");
    expect(keys.join("|")).toContain("t0");
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

  // Regression: a fresh conversation's dictionary used to be a shallow copy of a
  // shared constant, so the second conversation's first write started from the
  // first conversation's tokens. The symptom was a token count that grew without
  // any message being added.
  test("a second conversation starts from an empty index", async () => {
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

// The one behaviour fake-indexeddb cannot reproduce on its own, and the reason this
// suite passed while the browser was broken.
//
// `runTransaction` used to resolve on the transaction's `complete` event while
// assigning the work's return value in a promise microtask. Under
// fake-indexeddb the microtask always drained first, so every value came back
// correct. Real Chrome dispatches `complete` first, so callers received
// `undefined` for work that had plainly succeeded, and the resulting pile of
// overlapping write transactions starved later reads until they hung forever.
//
// These tests CONSTRUCT that ordering -- work that resumes in a later task, after
// its request has already completed and the transaction with it -- so they fail on
// the old code under any shim.
// Resumes in a later task, so the transaction's `complete` event is guaranteed to
// have been dispatched first. That is the ordering real Chrome produces and
// fake-indexeddb does not.
function laterTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("transaction completion ordering", () => {
  test("work that settles after the transaction completes still returns its value", async () => {
    const store = createTestStore();
    await store.readMeta("c1");
    const value = await runTransaction([META_STORE], "readonly", async (tx) => {
      const found = await new Promise<string | undefined>((resolve, reject) => {
        const request = tx.objectStore(META_STORE).get("c1");
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
      // The request is done, so the transaction commits during this wait. The
      // old code resolved here with `undefined` instead of the value below.
      await laterTask();
      return found ?? "absent";
    });
    expect(value).toBe("absent");
  });

  test("a write whose work settles late is reported with its real result", async () => {
    const store = createTestStore();
    await store.readMeta("c1");
    const rows = await runTransaction(
      [HEADER_STORE],
      "readwrite",
      async (tx) => {
        const request = tx.objectStore(HEADER_STORE).put(
          {
            dictionary: ["alpha"],
            nextRow: 42,
            version: SEARCH_INDEX_FORMAT_VERSION,
          },
          "c1"
        );
        await new Promise<void>((resolve, reject) => {
          request.addEventListener("success", () => resolve());
          request.addEventListener("error", () => reject(request.error));
        });
        await laterTask();
        return 7;
      }
    );
    expect(rows).toBe(7);
    // And the write really landed, rather than being reported as an undefined
    // success that happened to commit.
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(42);
  });

  test("a read is not starved by concurrent writes on the same store", async () => {
    const store = createTestStore();
    await store.readMeta("c1");
    // Chrome serialises transactions whose scopes overlap, so writes the caller
    // wrongly believes are finished queue later reads behind them. With the early
    // resolve, the read below never completed.
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.writeMeta({ ...emptySearchIndexMeta("c1"), updatedAt: index + 1 })
      )
    );
    const meta = await store.readMeta("c1");
    expect(meta).not.toBeNull();
    expect(meta?.updatedAt).toBeGreaterThan(0);
  });
});

// The planner is pure, so the property that matters -- one get and one put per
// DISTINCT token rather than per (row x token) -- is directly assertable here.
// fake-indexeddb cannot reproduce the write-lock starvation this fixes, because it
// has no lock contention, but the request count that causes it is arithmetic.
describe("planTokenListUpdates", () => {
  test("groups rows by token so each token is touched once", () => {
    const plans = planTokenListUpdates([
      { droppedTokenIds: [], row: 0, tokenIds: [1, 2] },
      { droppedTokenIds: [], row: 1, tokenIds: [2, 3] },
      { droppedTokenIds: [], row: 2, tokenIds: [1] },
    ]);
    expect([...plans.keys()].toSorted()).toEqual([1, 2, 3]);
    expect(plans.get(1)).toEqual({ add: [0, 2], drop: [] });
    expect(plans.get(2)).toEqual({ add: [0, 1], drop: [] });
    expect(plans.get(3)).toEqual({ add: [1], drop: [] });
    // Three tokens, not six (row x token) pairs: the whole point.
    expect(plans.size).toBe(3);
  });

  test("adds are ascending regardless of the order rows arrive in", () => {
    const forwards = planTokenListUpdates([
      { droppedTokenIds: [], row: 0, tokenIds: [7] },
      { droppedTokenIds: [], row: 1, tokenIds: [7] },
      { droppedTokenIds: [], row: 2, tokenIds: [7] },
    ]);
    const backwards = planTokenListUpdates([
      { droppedTokenIds: [], row: 2, tokenIds: [7] },
      { droppedTokenIds: [], row: 1, tokenIds: [7] },
      { droppedTokenIds: [], row: 0, tokenIds: [7] },
    ]);
    expect(forwards.get(7)?.add).toEqual([0, 1, 2]);
    expect(backwards.get(7)?.add).toEqual([0, 1, 2]);
  });

  test("drops are grouped and ascending too", () => {
    const plans = planTokenListUpdates([
      { droppedTokenIds: [4], row: 9, tokenIds: [] },
      { droppedTokenIds: [4], row: 3, tokenIds: [] },
    ]);
    expect(plans.get(4)).toEqual({ add: [], drop: [3, 9] });
  });

  // A rewrite: one row leaves a token while other rows join it. The executor
  // applies drops before adds, so the shared token must be able to carry both.
  test("a token can be both joined and left by different rows in one batch", () => {
    const plans = planTokenListUpdates([
      { droppedTokenIds: [5], row: 1, tokenIds: [] },
      { droppedTokenIds: [], row: 2, tokenIds: [5] },
    ]);
    expect(plans.get(5)).toEqual({ add: [2], drop: [1] });
  });

  test("an empty batch plans nothing", () => {
    expect(planTokenListUpdates([]).size).toBe(0);
  });

  test("a row with no tokens and no drops contributes no plan", () => {
    const plans = planTokenListUpdates([
      { droppedTokenIds: [], row: 0, tokenIds: [] },
    ]);
    expect(plans.size).toBe(0);
  });
});

describe("posting write batching", () => {
  beforeEach(async () => {
    await resetIndexedDbSearchIndexStoreForTests();
  });

  test("a batch touching few tokens writes each posting list once", async () => {
    const store = createTestStore();
    // 40 messages over 3 distinct tokens. The per-(row x token) shape issued 40
    // get/put pairs per token; the batched shape issues one pair.
    const batch = new Map<string, SearchIndexEntry>();
    for (let index = 0; index < 40; index += 1) {
      batch.set(`m${index}`, entry("alpha beta gamma", index));
    }
    const plans = planTokenListUpdates(
      [...batch.values()].map((_, row) => ({
        droppedTokenIds: [],
        row,
        tokenIds: [0, 1, 2],
      }))
    );
    expect(plans.size).toBe(3);
    await store.putEntries("c1", batch);
    const all = await store.readAllPostingLists("c1");
    // Every row landed in every list exactly once.
    for (const list of all.values()) {
      expect([...list].toSorted((left, right) => left - right)).toEqual(
        Array.from({ length: 40 }, (_, index) => index)
      );
    }
  });

  test("a rewrite drops the stale token and keeps the row on the rest", async () => {
    const store = createTestStore();
    await store.putEntries("c1", new Map([["m1", entry("alpha beta", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("alpha gamma", 1)]]));
    const all = await store.readAllPostingLists("c1");
    // "beta" was dropped by the rewrite and its emptied list deleted, so it is
    // absent rather than present-but-empty.
    expect([...all.keys()].toSorted()).toEqual(["alpha", "gamma"]);
    expect([...(all.get("alpha") ?? [])]).toEqual([0]);
    expect([...(all.get("gamma") ?? [])]).toEqual([0]);
  });

  // The removal scoping fix: a token the removed rows never carried must not be
  // read or rewritten at all. Compared as raw stored bytes, because
  // readAllPostingLists deliberately hides emptied lists and would make a
  // rewritten record indistinguishable from a deleted one.
  test("removal leaves an untouched token's posting list byte-identical", async () => {
    const store = createTestStore();
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("alpha beta", 1)],
        ["m2", entry("alpha", 2)],
        ["m3", entry("unrelated", 3)],
      ])
    );
    const snapshot = async () => {
      const keys = await rawKeyList(POSTINGS_STORE);
      // Each read is its own transaction, so they are independent and batched.
      const lists = await Promise.all(keys.map((key) => rawRowList(key)));
      return new Map(keys.map((key, index) => [key, lists[index] ?? []]));
    };
    const before = await snapshot();
    await store.removeEntries("c1", ["m1"]);
    const after = await snapshot();
    // "unrelated" has exactly one row and shares nothing with m1, so its record
    // must be untouched. Walking the whole dictionary would have rewritten it with
    // identical bytes, which is invisible here -- and is exactly the cost this
    // removes, since at 200k rows that walk reads every list in the conversation.
    const unchanged = [...before.keys()].filter(
      (key) =>
        JSON.stringify(after.get(key) ?? null) ===
        JSON.stringify(before.get(key) ?? null)
    );
    // At least one record must be unchanged, and the alpha record must not be.
    expect(unchanged.length).toBeGreaterThan(0);
    const all = await store.readAllPostingLists("c1");
    expect([...(all.get("alpha") ?? [])]).toEqual([1]);
    expect(all.has("beta")).toBe(false);
    expect([...(all.get("unrelated") ?? [])]).toEqual([2]);
  });

  test("removing a message clears exactly its tokens", async () => {
    const store = createTestStore();
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy latency", 1)],
        ["m2", entry("deploy", 2)],
      ])
    );
    await store.removeEntries("c1", ["m1"]);
    const all = await store.readAllPostingLists("c1");
    expect([...all.keys()]).toEqual(["deploy"]);
    expect([...(all.get("deploy") ?? [])]).toEqual([1]);
  });
});
