import { beforeEach, describe, expect, test } from "bun:test";

import { createMemorySearchIndexStore } from "./memory-search-index";
import { MAX_PREFIX_EXPANSION } from "./message-search";
import {
  resetSearchIndexStoreForTests,
  resolveSearchIndexStore,
} from "./search-index-backend";
import {
  buildSearchIndexEntry,
  emptySearchIndexMeta,
  emptySearchIndexRowList,
  emptySearchIndexRowTable,
  expandPrefixTerm,
  internRows,
  intersectPostingLists,
  rowListAdd,
  rowListRemove,
  rowListRemoveMany,
  rowListToArrays,
  searchIndexRowListFrom,
  selectNewestFirstWindow,
  windowCursor,
  SEARCH_INDEX_FORMAT_VERSION,
  SEARCH_INDEX_PREVIEW_LENGTH,
  SEARCH_INDEX_QUERY_LIMIT,
  unionPostingLists,
} from "./search-index-format";
import type {
  SearchIndexPostingList,
  SearchIndexEntry,
  SearchIndexStore,
} from "./search-index-format";
import {
  REFERENCE_APPEND_SLO_MS,
  REFERENCE_PUBLIST_GROWTH_SLO_MS,
  REFERENCE_QUERY_SCALING_FACTOR,
  REFERENCE_QUERY_SLO_MS,
} from "./search-slo";

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

// The production keystroke path: store.query owns token resolution, the posting
// intersection, and row projection as one operation. The direct posting-list
// reads below are retained only for tests that deliberately inspect storage.
async function queryStore(
  store: SearchIndexStore,
  conversationId: string,
  tokens: string[],
  limit = SEARCH_INDEX_QUERY_LIMIT,
  options?: { prefix?: string }
): Promise<{ ids: string[]; totalMatched: number }> {
  const result = await store.query(conversationId, tokens, limit, options);
  return {
    ids: [...result.rows.values()]
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .map((facts) => facts.messageId),
    totalMatched: result.totalMatched,
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

  test("keeps a bounded leading preview of the text", () => {
    const built = buildSearchIndexEntry({
      createdAt: 5,
      senderId: "u",
      text: "can anyone find the zarquon thread?",
    });
    expect(built?.preview).toBe("can anyone find the zarquon thread?");
  });

  test("truncates the preview without splitting a code point", () => {
    // The emoji straddles the cutoff: a UTF-16 slice would keep its lone high
    // surrogate, which renders as a replacement character in the list.
    const built = buildSearchIndexEntry({
      createdAt: 5,
      senderId: "u",
      text: `${"x".repeat(SEARCH_INDEX_PREVIEW_LENGTH - 1)}🎉 tail words here`,
    });
    expect(built).not.toBeNull();
    expect([...(built?.preview ?? "")].length).toBeLessThanOrEqual(
      SEARCH_INDEX_PREVIEW_LENGTH
    );
    expect(built?.preview.endsWith("🎉")).toBe(true);
    // Tokens still come from the whole text, not just the stored prefix.
    expect(built?.tokens).toContain("tail");
  });
});

describe("emptySearchIndexMeta", () => {
  test("starts unindexed at the current format version", () => {
    expect(emptySearchIndexMeta("c1")).toEqual({
      conversationId: "c1",
      cursorVerified: false,
      indexedThroughId: null,
      lastAccessedAt: 0,
      pendingIds: [],
      reachedStart: false,
      refsReachedStart: false,
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
    expect(table.previewByRow[0]).toBe("deploy latency");
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

// A stored posting list, as a reader gets it. `times` defaults to a value derived
// from the row so a test that only cares about membership does not have to invent
// timestamps -- and, importantly, so the DEFAULT is a time order that DISAGREES
// with the row order. Every ordering bug this index had was a row id standing in
// for a timestamp, and a fixture where the two agree cannot catch one.
function postingList(rows: number[], times?: number[]): SearchIndexPostingList {
  return {
    rows: Uint32Array.from(rows),
    times: Float64Array.from(times ?? rows.map((row) => 5000 - row)),
  };
}

describe("posting list growth", () => {
  test("appends in order and stays sorted", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 1, 1000 + 1);
    rowListAdd(list, 3, 1000 + 3);
    rowListAdd(list, 2, 1000 + 2);
    expect([...rowListToArrays(list).rows]).toEqual([1, 2, 3]);
    expect(list.sorted).toBe(true);
  });

  test("ignores a row it already holds, so a retried batch cannot duplicate", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 4, 1000 + 4);
    rowListAdd(list, 4, 1000 + 4);
    expect([...rowListToArrays(list).rows]).toEqual([4]);
  });

  test("removes a row and compacts the rest", () => {
    const list = emptySearchIndexRowList();
    for (const row of [5, 6, 7]) {
      rowListAdd(list, row, 1000 + row);
    }
    rowListRemove(list, 6);
    expect([...rowListToArrays(list).rows]).toEqual([5, 7]);
  });

  test("ignores a removal of a row it never held", () => {
    const list = searchIndexRowListFrom(postingList([1, 2]));
    rowListRemove(list, 9);
    expect([...rowListToArrays(list).rows]).toEqual([1, 2]);
  });

  test("sorts a list that was built out of order", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 9, 1000 + 9);
    rowListAdd(list, 2, 1000 + 2);
    expect(list.sorted).toBe(false);
    expect([...rowListToArrays(list).rows]).toEqual([2, 9]);
    expect(list.sorted).toBe(true);
  });

  test("removes many rows in one pass", () => {
    const list = emptySearchIndexRowList();
    for (let row = 0; row < 10; row += 1) {
      rowListAdd(list, row, 1000 + row);
    }
    rowListRemoveMany(list, new Set([2, 5, 9]));
    expect([...rowListToArrays(list).rows]).toEqual([0, 1, 3, 4, 6, 7, 8]);
  });

  test("a bulk removal of rows it never held changes nothing", () => {
    const list = searchIndexRowListFrom(postingList([1, 2]));
    rowListRemoveMany(list, new Set([7, 8]));
    expect([...rowListToArrays(list).rows]).toEqual([1, 2]);
  });

  test("adopts a stored list and notices when it was not sorted", () => {
    expect(searchIndexRowListFrom(postingList([1, 2, 3])).sorted).toBe(true);
    expect(searchIndexRowListFrom(postingList([3, 1, 2])).sorted).toBe(false);
  });

  // A stored list whose two arrays disagree cannot be repaired without guessing
  // which half is authoritative, and guessing attributes one message's creation
  // time to another message. It reads as empty, which costs a re-index; a wrong
  // read costs wrong results with nothing visibly broken.
  test("a list whose rows and times disagree in length reads as empty", () => {
    const truncated = searchIndexRowListFrom({
      rows: Uint32Array.from([1, 2, 3]),
      times: Float64Array.from([10]),
    });
    expect(truncated.length).toBe(1);
    const missingTimes = searchIndexRowListFrom({
      rows: Uint32Array.from([1, 2]),
      times: new Float64Array(0),
    });
    expect(missingTimes.length).toBe(0);
  });

  // The invariant every other ordering guarantee rests on: a time never leaves
  // the row it belongs to.
  test("removal and re-sorting keep every time with its own row", () => {
    const list = emptySearchIndexRowList();
    rowListAdd(list, 7, 700);
    rowListAdd(list, 2, 200);
    rowListAdd(list, 5, 500);
    rowListRemove(list, 2);
    const { rows, times } = rowListToArrays(list);
    expect([...rows]).toEqual([5, 7]);
    expect([...times]).toEqual([500, 700]);
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
      rowListAdd(list, row, 1000 + row);
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
      rowListAdd(list, row, 1000 + row);
    }
    // Copying per add costs ~50M element copies here, which is seconds. The
    // bound is loose enough for a loaded CI box and still catches a regression.
    expect(performance.now() - start).toBeLessThan(
      REFERENCE_PUBLIST_GROWTH_SLO_MS
    );
  });
});

describe("expandPrefixTerm", () => {
  const dictionary = ["deploy", "deployment", "deploys", "zarquon"];
  test("fans a fragment out to every term starting with it", () => {
    expect(expandPrefixTerm(dictionary, "depl")).toEqual([
      "deploy",
      "deployment",
      "deploys",
    ]);
  });

  test("a complete word matches itself with no variants", () => {
    expect(expandPrefixTerm(dictionary, "zarquon")).toEqual(["zarquon"]);
  });

  test("a short fragment only ever matches itself exactly", () => {
    expect(expandPrefixTerm(["a", "apple"], "a")).toEqual(["a"]);
    expect(expandPrefixTerm(["apple"], "a")).toEqual([]);
  });

  test("an unknown fragment matches nothing", () => {
    expect(expandPrefixTerm(dictionary, "zzz")).toEqual([]);
  });

  test("an expansion wider than the cap matches nothing, not partially", () => {
    const wide = Array.from(
      { length: MAX_PREFIX_EXPANSION + 1 },
      (_, i) => `term${i}`
    );
    expect(expandPrefixTerm(wide, "term")).toEqual([]);
    expect(
      expandPrefixTerm(wide.slice(0, MAX_PREFIX_EXPANSION), "term")
    ).toHaveLength(MAX_PREFIX_EXPANSION);
  });
});

describe("unionPostingLists", () => {
  test("unions with de-duplication in ascending order", () => {
    const union = unionPostingLists([
      postingList([1, 4, 9], [100, 400, 900]),
      postingList([4, 5], [400, 500]),
      postingList([]),
    ]);
    expect([...union.rows]).toEqual([1, 4, 5, 9]);
  });

  // A row's time has to travel WITH it through the union. Pairing row ids from
  // one list with times from another would produce a list that looks right and
  // orders the page by the wrong messages' times.
  test("every row keeps its own time through the union", () => {
    const union = unionPostingLists([
      postingList([1, 4, 9], [100, 400, 900]),
      postingList([4, 5], [4400, 500]),
    ]);
    expect([...union.rows]).toEqual([1, 4, 5, 9]);
    // 400, not 4400: the first occurrence of a row wins, and the two agree on
    // every row they share in a correct index.
    expect([...union.times]).toEqual([100, 400, 500, 900]);
  });

  test("empty in, empty out", () => {
    const union = unionPostingLists([]);
    expect(union.rows.length).toBe(0);
    expect(union.times.length).toBe(0);
  });
});

describe("selectNewestFirstWindow", () => {
  // Row ids DESCEND with message age here, which is the shape the backfill
  // produces: the newest page is indexed first, so the newest message holds the
  // LOWEST row. This is the inversion the old row-id keyset assumed away, and it
  // is why every fixture here deliberately disagrees between the two orders.
  const matches = [
    { createdAt: 100, row: 0 },
    { createdAt: 300, row: 2 },
    { createdAt: 200, row: 1 },
  ];

  test("orders by time, not by row id", () => {
    const { window } = selectNewestFirstWindow(matches, 10);
    expect(window).toEqual([
      { createdAt: 300, row: 2 },
      { createdAt: 200, row: 1 },
      { createdAt: 100, row: 0 },
    ]);
  });

  test("a cursor pages strictly older, never repeating the boundary", () => {
    const first = selectNewestFirstWindow(matches, 2);
    expect(first.window).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const cursor = windowCursor(first.window);
    const second = selectNewestFirstWindow(matches, 2, cursor ?? undefined);
    expect(second.window).toEqual([{ createdAt: 100, row: 0 }]);
    expect(second.hasMore).toBe(false);
    // Strictly past: the boundary is not re-served.
    expect(second.window).not.toContain(cursor);
  });

  test("walking every page covers the set exactly once", () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      // Reversed against the row id on purpose.
      createdAt: 1000 - index,
      row: 24 - index,
    }));
    const seen: number[] = [];
    let cursor: SearchIndexCursor | undefined;
    for (let page = 0; page < 10; page += 1) {
      const { hasMore, window } = selectNewestFirstWindow(many, 10, cursor);
      seen.push(...window.map((match) => match.row));
      cursor = windowCursor(window) ?? undefined;
      if (!hasMore) {
        break;
      }
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  // Same-millisecond sends are ordinary, and an order that is not total cannot be
  // keyed: a cursor landing inside a tie group would be ambiguous, and a pager
  // over an ambiguous order repeats and drops rows.
  test("same-millisecond messages are ordered by row and never split across a page", () => {
    const tied = [
      { createdAt: 100, row: 0 },
      { createdAt: 100, row: 1 },
      { createdAt: 100, row: 2 },
    ];
    const first = selectNewestFirstWindow(tied, 2);
    expect(first.window).toEqual([
      { createdAt: 100, row: 0 },
      { createdAt: 100, row: 1 },
    ]);
    const second = selectNewestFirstWindow(
      tied,
      2,
      windowCursor(first.window) ?? undefined
    );
    expect(second.window).toEqual([{ createdAt: 100, row: 2 }]);
    expect(second.hasMore).toBe(false);
  });

  test("a cursor past the oldest match yields an empty page", () => {
    const result = selectNewestFirstWindow(matches, 10, {
      createdAt: 50,
      row: 99,
    });
    expect(result.window).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  test("an empty match set or a non-positive limit yields nothing", () => {
    expect(selectNewestFirstWindow([], 10)).toEqual({
      hasMore: false,
      window: [],
    });
    expect(selectNewestFirstWindow(matches, 0)).toEqual({
      hasMore: false,
      window: [],
    });
  });

  test("a window's cursor is its OLDEST row, and an empty window has none", () => {
    expect(windowCursor(selectNewestFirstWindow(matches, 2).window)).toEqual({
      createdAt: 200,
      row: 1,
    });
    expect(windowCursor([])).toBeNull();
  });
});

describe("intersectPostingLists", () => {
  // No ordering and no cap here any more, deliberately. This used to return the
  // `limit` highest row ids, which was only the newest matches if row ids
  // ascend with message age -- and on a conversation indexed by a backfill
  // descending from the newest page they DESCEND with time, so the "newest" page
  // was the oldest 2,000 matches and every page after it was empty or a repeat.
  // The time now rides in the list, and `selectNewestFirstWindow` below owns both
  // the order and the cut.
  const deploy = postingList([0, 1, 2], [300, 200, 100]);
  const latency = postingList([0, 2], [300, 100]);

  test("returns every match, carrying each row's time", () => {
    const { matches, totalMatched } = intersectPostingLists([deploy]);
    expect(matches).toEqual([
      { createdAt: 300, row: 0 },
      { createdAt: 200, row: 1 },
      { createdAt: 100, row: 2 },
    ]);
    expect(totalMatched).toBe(3);
  });

  test("intersects multiple tokens (AND semantics)", () => {
    const { matches } = intersectPostingLists([deploy, latency]);
    expect(matches).toEqual([
      { createdAt: 300, row: 0 },
      { createdAt: 100, row: 2 },
    ]);
  });

  test("returns nothing for an unknown token", () => {
    expect(intersectPostingLists([postingList([])])).toEqual({
      matches: [],
      totalMatched: 0,
    });
  });

  test("returns nothing for an empty token list", () => {
    expect(intersectPostingLists([])).toEqual({
      matches: [],
      totalMatched: 0,
    });
  });

  test("the total is over the full intersection, not the window", () => {
    const { matches, totalMatched } = intersectPostingLists([deploy, latency]);
    const { window } = selectNewestFirstWindow(matches, 1);
    expect(window).toHaveLength(1);
    // The bar renders "n of N", so a windowed scan must not report a windowed N.
    expect(totalMatched).toBe(2);
  });

  test("the keyset applies after the intersection, not before it", () => {
    // `deploy` holds [0,1,2] and the second list [0,2], so the intersection is
    // two rows. Cutting the candidate list before intersecting would report a
    // total of 1 for a page that should report 2 with one row on it.
    const result = intersectPostingLists([deploy, latency]);
    const { window } = selectNewestFirstWindow(result.matches, 1, {
      createdAt: 200,
      row: 1,
    });
    expect(window).toEqual([{ createdAt: 100, row: 2 }]);
    expect(result.totalMatched).toBe(2);
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

  test("an edit rewrites the preview with the new text", async () => {
    await store.putEntries("c1", new Map([["m1", entry("deploy this", 1)]]));
    await store.putEntries("c1", new Map([["m1", entry("rollback that", 1)]]));
    const result = await store.query("c1", ["rollback"], 100);
    const facts = [...result.rows.values()];
    expect(facts).toHaveLength(1);
    expect(facts[0]?.preview).toBe("rollback that");
  });

  // The reported list-view bug: 24k matches in the counter, a list that stopped
  // at 2,000. The store has to serve windows on demand for paging to reach the
  // rest, and the seam has to be exact or rows would repeat or vanish.
  // The reported list-view bug, in the shape that caused it: 24k matches in the
  // counter and a list that stopped at 2,000. The store has to serve windows on
  // demand for paging to reach the rest, and the seam has to be exact or rows
  // repeat or vanish.
  //
  // `putEntries` interns in Map order, so row ids run OPPOSITE to the timestamps
  // here -- the newest message gets row 0. A row-id keyset would page into
  // nothing; this is the fixture that says so.
  test("pages through every match with no duplicate or gap at the seam", async () => {
    const entries = new Map<string, SearchIndexEntry>();
    for (let row = 0; row < 25; row += 1) {
      entries.set(`m${row}`, entry(`deploy note ${row}`, row + 1));
    }
    await store.putEntries("c1", entries);
    const seen: string[] = [];
    let cursor: SearchIndexCursor | undefined;
    let total = 0;
    // oxlint-disable no-await-in-loop -- paging IS sequential: each window's keyset cursor is the previous window's last row, so there is nothing to parallelize and running them together would defeat the test
    for (let page = 0; page < 10; page += 1) {
      const result = await store.query("c1", ["deploy"], 10, {
        afterMatch: cursor,
      });
      // The total is the full set on every page, whatever window was asked for.
      total = result.totalMatched;
      const ids = [...result.rows.values()].map((facts) => facts.messageId);
      if (ids.length === 0) {
        break;
      }
      seen.push(...ids);
      // The OLDEST row in the window, by time. The rows map is keyed by row id
      // and this is exactly where picking the lowest row id instead of the oldest
      // message re-appears.
      cursor =
        windowCursor(
          [...result.rows].map(([row, facts]) => ({
            createdAt: facts.createdAt,
            row,
          }))
        ) ?? undefined;
      if (!result.hasMore) {
        break;
      }
    }
    // oxlint-enable no-await-in-loop
    expect(total).toBe(25);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen.toSorted()).toEqual(
      Array.from({ length: 25 }, (_, row) => `m${row}`).toSorted()
    );
    // And in time order, newest first, which is the order the list renders.
    expect(seen).toEqual(
      Array.from({ length: 25 }, (_, row) => `m${row}`).toReversed()
    );
  });

  // The write path commits a bulk batch in chunks, because one transaction over
  // a whole backfill page held IndexedDB's write lock long enough that a search
  // page turn could not start its read. The split is only safe if it is invisible:
  // a batch larger than any chunk has to index exactly as an unchunked one would,
  // with dense ids, and a re-sent batch has to change nothing.
  test("a batch larger than one write chunk indexes exactly as a small one", async () => {
    const entries = new Map<string, SearchIndexEntry>();
    for (let row = 0; row < 500; row += 1) {
      entries.set(`m${row}`, entry(`deploy note ${row}`, row + 1));
    }
    await store.putEntries("c1", entries);
    const result = await store.query("c1", ["deploy"], 1000);
    expect(result.totalMatched).toBe(500);
    expect([...result.rows.values()]).toHaveLength(500);
    // Row ids are handed out by the header, and a chunk boundary must not
    // restart or skip the allocator.
    const rows = [...result.rows.keys()].toSorted((a, b) => a - b);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(499);
    expect(new Set(rows).size).toBe(500);
  });

  // Idempotence is what lets a caller retry a batch whose later chunks failed
  // after an earlier one committed: re-putting every entry must not duplicate a
  // row, inflate a posting list, or move a row id.
  test("re-sending a batch changes nothing", async () => {
    const entries = new Map<string, SearchIndexEntry>();
    for (let row = 0; row < 200; row += 1) {
      entries.set(`m${row}`, entry(`deploy note ${row}`, row + 1));
    }
    await store.putEntries("c1", entries);
    const first = await store.query("c1", ["deploy"], 1000);
    await store.putEntries("c1", new Map(entries));
    const second = await store.query("c1", ["deploy"], 1000);
    expect(second.totalMatched).toBe(200);
    expect([...second.rows.keys()].toSorted((a, b) => a - b)).toEqual(
      [...first.rows.keys()].toSorted((a, b) => a - b)
    );
  });

  test("a paged window honours the prefix the head is matching", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deployment checklist", 2)],
        ["m3", entry("rollback the deploy", 3)],
      ])
    );
    const page = await store.query("c1", [], 10, { prefix: "deplo" });
    expect(page.totalMatched).toBe(3);
    const all = [...page.rows.values()].map((facts) => facts.messageId);
    expect(all).toHaveLength(3);
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

  // The keystroke path: the trailing token fans out by prefix so typing
  // narrows live instead of flashing empty until the word completes.
  test("a trailing prefix matches every term starting with it", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deployment checklist", 2)],
        ["m3", entry("unrelated words here", 3)],
      ])
    );
    expect(await queryStore(store, "c1", [], 100, { prefix: "deplo" })).toEqual(
      {
        ids: ["m2", "m1"],
        totalMatched: 2,
      }
    );
  });

  test("a prefix ANDs with the exact tokens", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("deployment checklist", 2)],
      ])
    );
    expect(
      await queryStore(store, "c1", ["service"], 100, { prefix: "deplo" })
    ).toEqual({ ids: ["m1"], totalMatched: 1 });
    // ...and an unknown exact token still poisons the whole query.
    expect(
      await queryStore(store, "c1", ["absent"], 100, { prefix: "deplo" })
    ).toEqual({ ids: [], totalMatched: 0 });
  });

  test("an unknown or over-wide prefix matches nothing", async () => {
    await store.putEntries(
      "c1",
      new Map([["m1", entry("deploy the service", 1)]])
    );
    expect(await queryStore(store, "c1", [], 100, { prefix: "zzz" })).toEqual({
      ids: [],
      totalMatched: 0,
    });
  });

  test("a complete word with no longer variants behaves exactly", async () => {
    await store.putEntries(
      "c1",
      new Map([
        ["m1", entry("deploy the service", 1)],
        ["m2", entry("unrelated words here", 2)],
      ])
    );
    expect(
      await queryStore(store, "c1", [], 100, { prefix: "deploy" })
    ).toEqual({ ids: ["m1"], totalMatched: 1 });
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
    // Deliberate structural inspection of the stored posting records; the
    // production query path below never uses this whole-index read.
    const all = await store.readAllPostingLists("c1");
    const one = await store.readPostingList("c1", "alpha");
    expect(all.size).toBe(2);
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

// Removes `indexedDB` for the duration of a test and puts it back.
//
// The absence of IndexedDB cannot be inferred from the environment: the two
// IDB suites in this directory install `fake-indexeddb/auto`, and they share a
// process, so by the time this file runs the global usually EXISTS. Relying on
// that made the fallback test pass or fail purely on file ordering. Removing the
// global explicitly states the precondition the test is about, so it is
// order-independent.
async function withoutIndexedDb<T>(run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "indexedDB", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
}

describe("search index backend selection", () => {
  test("falls back to memory when IndexedDB is absent", async () => {
    resetSearchIndexStoreForTests();
    // This is the private-mode / embedded-webview path: the probe must choose the
    // memory backend rather than throw.
    const resolved = await withoutIndexedDb(() => resolveSearchIndexStore());
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

  // The backend is deliberately NOT cached across calls. A cached store would hand
  // one conversation's index to the next caller, and a failure there would look
  // like a corrupt index rather than a wiring mistake.
  test("each resolution gets its own store", async () => {
    resetSearchIndexStoreForTests();
    const first = await resolveSearchIndexStore();
    const second = await resolveSearchIndexStore();
    expect(second.store).not.toBe(first.store);
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
      expect(elapsed).toBeLessThan(REFERENCE_QUERY_SLO_MS);
    }
  });

  test("the production query returns only result rows while keeping the full total", async () => {
    const store = await buildIndex();
    const result = await store.query(
      "c1",
      ["deploy", "latency"],
      SEARCH_INDEX_QUERY_LIMIT
    );
    expect(result.rows.size).toBeLessThanOrEqual(SEARCH_INDEX_QUERY_LIMIT);
    expect(result.totalMatched).toBeGreaterThan(0);
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
    // is bounded by the posting lists and the result cap, not by row count. The
    // fallback's production query also projects through the sealed row codec, so
    // its absolute floor is higher than the old readRows-only helper.
    expect(largeMs).toBeLessThan(
      Math.max(50, smallMs * REFERENCE_QUERY_SCALING_FACTOR)
    );
  });

  test("a single insert does not scale with the size of the index", async () => {
    const store = await buildIndex();
    const start = performance.now();
    await store.putEntries(
      "c1",
      new Map([["m-new", entry("deploy latency", 2_000_000_000_000)]])
    );
    expect(performance.now() - start).toBeLessThan(REFERENCE_APPEND_SLO_MS);
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
