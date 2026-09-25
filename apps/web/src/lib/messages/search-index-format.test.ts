import { beforeEach, describe, expect, test } from "bun:test";

import { createMemorySearchIndexStore } from "./memory-search-index";
import {
  resetSearchIndexStoreForTests,
  resolveSearchIndexStore,
} from "./search-index-backend";
import {
  buildSearchIndexEntry,
  emptySearchIndexMeta,
  emptySearchIndexRowList,
  emptySearchIndexRowTable,
  internRows,
  intersectPostingLists,
  rowListAdd,
  rowListRemove,
  rowListRemoveMany,
  rowListToArray,
  searchIndexRowListFrom,
  SEARCH_INDEX_FORMAT_VERSION,
  SEARCH_INDEX_QUERY_LIMIT,
} from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";

type Store = SearchIndexStore & {
  conversations: () => string[];
  postingFor: (conversationId: string) => Map<string, Uint32Array>;
  tokenCount: (conversationId: string) => number;
};

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

// Runs a query exactly the way the hook does: one posting-list read per token,
// intersected against the row table. Testing through this path is deliberate, so
// a change that only works against a whole-index load cannot pass.
async function queryStore(
  store: SearchIndexStore,
  conversationId: string,
  tokens: string[],
  limit = SEARCH_INDEX_QUERY_LIMIT
): Promise<{ ids: string[]; totalMatched: number }> {
  const lists = await Promise.all(
    tokens.map((token) => store.readPostingList(conversationId, token))
  );
  const { rows, totalMatched } = intersectPostingLists(lists, limit);
  const resolved = await store.readRows(conversationId, Uint32Array.from(rows));
  return {
    ids: [...resolved.values()]
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .map((facts) => facts.messageId),
    totalMatched,
  };
}

describe("buildSearchIndexEntry", () => {
  test("normalizes, dedupes, and sorts tokens", () => {
    const built = buildSearchIndexEntry({
      createdAt: 5,
      senderId: "u",
      text: "Deploy DEPLOY café naïve",
    });
    expect(built?.tokens).toEqual(["cafe", "deploy", "naive"]);
  });

  test("returns null when there is nothing to match", () => {
    expect(
      buildSearchIndexEntry({ createdAt: 1, senderId: "u", text: "   " })
    ).toBeNull();
    expect(
      buildSearchIndexEntry({ createdAt: 1, senderId: "u", text: "" })
    ).toBeNull();
  });
});

describe("emptySearchIndexMeta", () => {
  test("starts unindexed at the current format version", () => {
    expect(emptySearchIndexMeta("c1")).toEqual({
      conversationId: "c1",
      indexedThroughId: null,
      lastAccessedAt: 0,
      pendingIds: [],
      updatedAt: 0,
      version: SEARCH_INDEX_FORMAT_VERSION,
    });
  });
});

describe("internRows", () => {
  test("assigns dense row ids and records each row's facts", () => {
    const table = emptySearchIndexRowTable();
    const { newRows, tokensByRow } = internRows(
      table,
      new Map([
        ["m1", entry("deploy latency", 10, "alice")],
        ["m2", entry("deploy", 20, "bob")],
      ])
    );
    expect(newRows).toEqual([0, 1]);
    expect(table.rowsByMessageId.get("m1")).toBe(0);
    expect(table.rowsByMessageId.get("m2")).toBe(1);
    expect(table.messageIdByRow[1]).toBe("m2");
    expect(table.createdAtByRow[1]).toBe(20);
    expect(table.senderIdByRow[0]).toBe("alice");
    expect(tokensByRow.get(0)).toEqual(["deploy", "latency"]);
  });

  test("reuses the row id for a message it has already seen", () => {
    const table = emptySearchIndexRowTable();
    internRows(table, new Map([["m1", entry("deploy", 10)]]));
    const { newRows, tokensByRow } = internRows(
      table,
      new Map([["m1", entry("rollback", 10)]])
    );
    // A rewrite must not consume a second id: ids are what posting lists hold.
    expect(newRows).toEqual([]);
    expect(table.rowsByMessageId.get("m1")).toBe(0);
    expect(table.messageIdByRow.length).toBe(1);
    expect(tokensByRow.get(0)).toEqual(["rollback"]);
  });
});

describe("posting list growth", () => {
  test("appends in order and stays sorted", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 1);
    rowListAdd(list, 3);
    rowListAdd(list, 2);
    expect([...rowListToArray(list)]).toEqual([1, 2, 3]);
    expect(list.sorted).toBe(true);
  });

  test("ignores a row it already holds, so a retried batch cannot duplicate", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 4);
    rowListAdd(list, 4);
    expect([...rowListToArray(list)]).toEqual([4]);
  });

  test("removes a row and compacts the rest", () => {
    const list = emptySearchIndexRowList();
    for (const row of [5, 6, 7]) {
      rowListAdd(list, row);
    }
    rowListRemove(list, 6);
    expect([...rowListToArray(list)]).toEqual([5, 7]);
  });

  test("ignores a removal of a row it never held", () => {
    const list = searchIndexRowListFrom(new Uint32Array([1, 2]));
    rowListRemove(list, 9);
    expect([...rowListToArray(list)]).toEqual([1, 2]);
  });

  test("sorts a list that was built out of order", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 9);
    rowListAdd(list, 2);
    expect(list.sorted).toBe(false);
    expect([...rowListToArray(list)]).toEqual([2, 9]);
    expect(list.sorted).toBe(true);
  });

  test("removes many rows in one pass", () => {
    const list = emptySearchIndexRowList();
    for (let row = 0; row < 10; row += 1) {
      rowListAdd(list, row);
    }
    rowListRemoveMany(list, new Set([2, 5, 9]));
    expect([...rowListToArray(list)]).toEqual([0, 1, 3, 4, 6, 7, 8]);
  });

  test("a bulk removal of rows it never held changes nothing", () => {
    const list = searchIndexRowListFrom(new Uint32Array([1, 2]));
    rowListRemoveMany(list, new Set([7, 8]));
    expect([...rowListToArray(list)]).toEqual([1, 2]);
  });

  test("adopts a stored list and notices when it was not sorted", () => {
    expect(searchIndexRowListFrom(new Uint32Array([1, 2, 3])).sorted).toBe(
      true
    );
    expect(searchIndexRowListFrom(new Uint32Array([3, 1, 2])).sorted).toBe(
      false
    );
  });

  // The quadratic-write regression: a posting list is a typed array, so an
  // implementation that copies on every add re-copies an 80k-row list for each
  // message containing that token. Measured at 200k messages, that was 1,679
  // msgs/s instead of 20,700. Capacity must therefore grow geometrically, which
  // is observable without a timer: an exact-size-per-add implementation would
  // leave capacity == length.
  test("grows capacity geometrically instead of per row", () => {
    const list = emptySearchIndexRowList();
    const TOTAL = 10_000;
    for (let row = 0; row < TOTAL; row += 1) {
      rowListAdd(list, row);
    }
    expect(list.length).toBe(TOTAL);
    expect(list.values.length).toBeGreaterThanOrEqual(TOTAL);
    // Doubling from a floor of 16 keeps total capacity under 4x the used length.
    expect(list.values.length).toBeLessThan(TOTAL * 4);
  });

  test("appending ten thousand rows stays far below a quadratic budget", () => {
    const list = emptySearchIndexRowList();
    const start = performance.now();
    for (let row = 0; row < 10_000; row += 1) {
      rowListAdd(list, row);
    }
    // Copying per add costs ~50M element copies here, which is seconds. The
    // bound is loose enough for a loaded CI box and still catches a regression.
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe("intersectPostingLists", () => {
  // Row ids ascend with insertion order, so descending row id is
  // newest-indexed-first. Timestamps are no longer this function's concern: the
  // rows are not known until it returns, and the caller reorders once it has
  // resolved their facts.
  const deploy = new Uint32Array([0, 1, 2]);
  const latency = new Uint32Array([0, 2]);

  test("returns the newest-indexed matches first", () => {
    const { rows } = intersectPostingLists([deploy], 100);
    expect(rows).toEqual([2, 1, 0]);
  });

  test("intersects multiple tokens (AND semantics)", () => {
    const { rows } = intersectPostingLists([deploy, latency], 100);
    expect(rows).toEqual([2, 0]);
  });

  test("returns nothing for an unknown token", () => {
    expect(intersectPostingLists([new Uint32Array(0)], 100)).toEqual({
      rows: [],
      totalMatched: 0,
    });
  });

  test("returns nothing for an empty token list or a non-positive limit", () => {
    expect(intersectPostingLists([], 100)).toEqual({
      rows: [],
      totalMatched: 0,
    });
    expect(intersectPostingLists([deploy], 0)).toEqual({
      rows: [],
      totalMatched: 0,
    });
  });

  test("reports the full total even when the rows are capped", () => {
    const { rows, totalMatched } = intersectPostingLists([deploy], 2);
    // The bar renders "n of N", so a capped scan must not report a capped N.
    expect(rows.length).toBe(2);
    expect(totalMatched).toBe(3);
  });

  test("the cap keeps the newest-indexed rows", () => {
    const { rows } = intersectPostingLists([deploy], 1);
    expect(rows).toEqual([2]);
  });
});

describe("memory search index store", () => {
  let store: Store;

  beforeEach(() => {
    store = createMemorySearchIndexStore() as Store;
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

  test("keeps conversations isolated", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c2", new Map([["m9", entry("deploy", 1)]]));
    const inOne = await queryStore(store, "c1", ["deploy"]);
    const inTwo = await queryStore(store, "c2", ["deploy"]);
    expect(inOne.ids).toEqual(["m1"]);
    expect(inTwo.ids).toEqual(["m9"]);
    expect(store.conversations().toSorted()).toEqual(["c1", "c2"]);
  });

  test("an empty batch is a no-op", async () => {
    await store.putEntries("c1", new Map());
    expect(store.postingFor("c1").size).toBe(0);
  });

  test("a rewrite replaces the old tokens instead of appending", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("rollback", 1)]]));
    // The stale token must be gone entirely, not left as a phantom match.
    expect(await queryStore(store, "c1", ["deploy"])).toEqual({
      ids: [],
      totalMatched: 0,
    });
    const afterRewrite = await queryStore(store, "c1", ["rollback"]);
    expect(afterRewrite.ids).toEqual(["m1"]);
  });

  test("re-indexing the same text does not duplicate the row", async () => {
    const batch = new Map([["m1", entry("deploy latency", 1)]]);
    await store.putEntries("c1", batch);
    await store.putEntries("c1", new Map(batch));
    const list = await store.readPostingList("c1", "deploy");
    expect([...list]).toEqual([0]);
  });

  test("a rewritten message keeps its original row id", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("rollback", 1)]]));
    // Still row 0: a rewrite must not consume a second id, or the posting lists
    // would hold two entries for one message.
    const resolved = await store.readRows("c1", Uint32Array.from([0]));
    expect(resolved.get(0)?.messageId).toBe("m1");
    const stats = await store.readStats("c1");
    expect(stats.indexedRowCount).toBe(1);
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

  test("removing a message drops tokens only it had", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy latency", 1)],
        ["m2", entry("deploy", 2)],
      ])
    );
    await store.removeEntries("c1", ["m1"]);
    expect(store.tokenCount("c1")).toBe(1);
    const { ids } = await queryStore(store, "c1", ["latency"]);
    expect(ids).toEqual([]);
  });

  test("removing an unknown id changes nothing", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.removeEntries("c1", ["nope"]);
    const survivor = await queryStore(store, "c1", ["deploy"]);
    expect(survivor.ids).toEqual(["m1"]);
  });

  test("a single read returns one token, not the whole index", async () => {
    await store.putEntries(
      "c1",
      new Map([entryPair("m1", "alpha beta"), entryPair("m2", "alpha")])
    );
    const all = await store.readAllPostingLists("c1");
    const one = await store.readPostingList("c1", "alpha");
    expect(all.size).toBe(2);
    // The point of the format: the keystroke path pays for one list, not two.
    expect([...one].length).toBe(2);
  });

  test("a posting-list read cannot mutate the store", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const list = await store.readPostingList("c1", "deploy");
    list[0] = 999;
    const reread = await store.readPostingList("c1", "deploy");
    expect([...reread]).toEqual([0]);
  });

  test("a bulk read hands back a map the caller cannot use to mutate the store", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    const all = await store.readAllPostingLists("c1");
    all.set("rollback", new Uint32Array([5]));
    all.delete("deploy");
    expect(store.tokenCount("c1")).toBe(1);
  });

  test("readRows resolves only the rows asked for", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("alpha", 10, "alice")],
        ["m2", entry("beta", 20, "bob")],
      ])
    );
    const resolved = await store.readRows("c1", Uint32Array.from([1]));
    // One row in, one row out: the contract that keeps search memory flat as a
    // conversation grows.
    expect(resolved.size).toBe(1);
    expect(resolved.get(1)?.messageId).toBe("m2");
    expect(resolved.get(1)?.createdAt).toBe(20);
    expect(resolved.get(1)?.senderId).toBe("bob");
  });

  test("readRows skips a row that no longer exists", async () => {
    const resolved = await store.readRows("c1", Uint32Array.from([7]));
    expect(resolved.size).toBe(0);
  });

  test("readStats reports rows interned so far", async () => {
    const before = await store.readStats("c1");
    expect(before.indexedRowCount).toBe(0);
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("alpha", 1)],
        ["m2", entry("beta", 2)],
      ])
    );
    const afterTwo = await store.readStats("c1");
    expect(afterTwo.indexedRowCount).toBe(2);
    // A rewrite is the same row, not a new one.
    await store.putEntries("c1", new Map([["m1", entry("gamma", 1)]]));
    const afterRewrite = await store.readStats("c1");
    expect(afterRewrite.indexedRowCount).toBe(2);
  });

  test("clearing a conversation drops entries, meta, and row ids", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy", 1)]]));
    await store.writeMeta(emptySearchIndexMeta("c1"));
    expect(await store.readMeta("c1")).not.toBeNull();
    await store.clearConversation("c1");
    expect(await store.readMeta("c1")).toBeNull();
    expect(store.postingFor("c1").size).toBe(0);
    const cleared = await store.readStats("c1");
    expect(cleared.indexedRowCount).toBe(0);
  });

  test("meta is stored by value, so a later mutation cannot corrupt it", async () => {
    const meta = { ...emptySearchIndexMeta("c1"), pendingIds: ["m1"] };
    await store.writeMeta(meta);
    meta.pendingIds.push("m2");
    const stored = await store.readMeta("c1");
    expect(stored?.pendingIds).toEqual(["m1"]);
  });

  test("two stores do not share meta", async () => {
    const other = createMemorySearchIndexStore() as Store;
    await other.writeMeta(emptySearchIndexMeta("c1"));
    expect(await store.readMeta("c1")).toBeNull();
  });

  test("unknown conversation reads as empty, not an error", async () => {
    expect(await store.readMeta("nope")).toBeNull();
    expect(await queryStore(store, "nope", ["anything"])).toEqual({
      ids: [],
      totalMatched: 0,
    });
    const emptyStats = await store.readStats("nope");
    expect(emptyStats.indexedRowCount).toBe(0);
  });

  function entryPair(id: string, text: string): [string, SearchIndexEntry] {
    return [id, entry(text, 1)];
  }
});

describe("search index backend selection", () => {
  test("falls back to memory when IndexedDB is absent", async () => {
    resetSearchIndexStoreForTests();
    // Bun has no IndexedDB, so the probe must choose the memory backend rather
    // than throw. This is the private-mode / embedded-webview path.
    const resolved = await resolveSearchIndexStore();
    expect(resolved.backend).toBe("memory");
    // The fallback is still a working store, not a stub.
    await resolved.store.putEntries(
      "c1",
      new Map([["m1", entry("deploy", 1)]])
    );
    const found = await queryStore(resolved.store, "c1", ["deploy"]);
    expect(found.ids).toEqual(["m1"]);
    resetSearchIndexStoreForTests();
  });

  test("resolution is cached for the session", async () => {
    resetSearchIndexStoreForTests();
    const first = await resolveSearchIndexStore();
    const second = await resolveSearchIndexStore();
    expect(second.store).toBe(first.store);
    resetSearchIndexStoreForTests();
  });
});

describe("query performance budget", () => {
  // Guards the three shapes that actually blew the budget once already:
  //  - loading every posting list to answer one keystroke (146MB of RAM at 200k),
  //  - sorting every match on each keystroke (cost scaled with history), and
  //  - copying every map per write (a single insert cost 58ms at 200k).
  // 20k messages keeps the suite fast while all three regressions are still
  // orders of magnitude slower than the fixed path; the measured 200k figures
  // are in the phase notes (queries 0.25-13ms, single insert 3.7ms).
  const TOTAL = 20_000;
  const WORDS = [
    "deploy",
    "latency",
    "rollout",
    "incident",
    "cache",
    "index",
    "query",
    "shard",
    "replica",
    "schema",
  ];
  const makeText = (index: number) => {
    const out: string[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      out.push(WORDS[(index * 7 + offset * 3) % WORDS.length]);
    }
    return out.join(" ");
  };

  async function buildIndex(total = TOTAL): Promise<Store> {
    const store = createMemorySearchIndexStore() as Store;
    // Batched, and sequential: the store must be written one batch at a time,
    // which is also how the real backfill path drives it.
    // oxlint-disable no-await-in-loop -- batches are written one at a time
    for (let start = 0; start < total; start += 500) {
      const batch = new Map<string, SearchIndexEntry>();
      for (
        let index = start;
        index < Math.min(start + 500, TOTAL);
        index += 1
      ) {
        const built = buildSearchIndexEntry({
          createdAt: 1_700_000_000_000 + index,
          senderId: "u",
          text: makeText(index),
        });
        if (built) {
          batch.set(`m${index}`, built);
        }
      }
      await store.putEntries("c1", batch);
    }
    return store;
  }

  test("stays interactive for single, multi-token, and empty queries", async () => {
    const store = await buildIndex();
    // Each iteration is timed separately and must run in sequence: overlapping
    // the reads would hide exactly the per-keystroke cost being measured.
    // oxlint-disable no-await-in-loop -- sequential by design
    for (const tokens of [["deploy"], ["deploy", "latency"], ["nope"]]) {
      const start = performance.now();
      const result = await queryStore(store, "c1", tokens);
      const elapsed = performance.now() - start;
      expect(result.ids.length).toBeLessThanOrEqual(SEARCH_INDEX_QUERY_LIMIT);
      expect(elapsed).toBeLessThan(100);
    }
  });

  test("a query reads only the tokens and rows it needs", async () => {
    const store = await buildIndex();
    let postingReads = 0;
    let rowsRequested = 0;
    const counting: SearchIndexStore = {
      ...store,
      readPostingList(conversationId, token) {
        postingReads += 1;
        return store.readPostingList(conversationId, token);
      },
      readRows(conversationId, rowIds) {
        rowsRequested += rowIds.length;
        return store.readRows(conversationId, rowIds);
      },
    };
    await queryStore(counting, "c1", ["deploy", "latency"]);
    // Two words, two posting reads. The 200k regression was one read per token in
    // the conversation, which is the whole reason for the per-token layout.
    expect(postingReads).toBe(2);
    // And rows are resolved per RESULT, never per conversation. This is the read
    // that used to walk all 20,000 rows and hold them in memory.
    expect(rowsRequested).toBeLessThanOrEqual(SEARCH_INDEX_QUERY_LIMIT);
  });

  test("a query does not scale with the size of the conversation", async () => {
    const small = await buildIndex(2000);
    const large = await buildIndex(20_000);
    const timeOne = async (store: SearchIndexStore) => {
      const start = performance.now();
      await queryStore(store, "c1", ["deploy", "latency"]);
      return performance.now() - start;
    };
    const smallMs = Math.min(await timeOne(small), await timeOne(small));
    const largeMs = Math.min(await timeOne(large), await timeOne(large));
    // 10x the conversation must not mean anything like 10x the query: the read
    // is bounded by the posting lists and the result cap, not by row count.
    expect(largeMs).toBeLessThan(Math.max(20, smallMs * 4));
  });

  test("a single insert does not scale with the size of the index", async () => {
    const store = await buildIndex();
    const start = performance.now();
    await store.putEntries(
      "c1",
      new Map([["m-new", entry("deploy latency", 2_000_000_000_000)]])
    );
    expect(performance.now() - start).toBeLessThan(50);
  });

  test("caps materialized rows while reporting the full total", async () => {
    const store = await buildIndex();
    const { ids, totalMatched } = await queryStore(store, "c1", ["deploy"], 50);
    expect(ids.length).toBeLessThanOrEqual(50);
    // The counter's N must survive the cap.
    expect(totalMatched).toBeGreaterThan(ids.length);
  });

  test("resolved rows are presented newest-first", async () => {
    const store = await buildIndex();
    const { ids } = await queryStore(store, "c1", ["deploy"], 200);
    // The intersect returns rows newest-indexed-first and the caller reorders by
    // timestamp; the two coincide for a chronologically indexed conversation,
    // which is what the corpus generates.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(200);
    // The corpus generates ascending timestamps, so newest-first is descending
    // id order.
    const descending = ids.map((id) => Number(id.slice(1)));
    expect(descending).toEqual(descending.toSorted((a, b) => b - a));
  });
});
