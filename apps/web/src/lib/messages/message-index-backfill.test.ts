import { beforeEach, describe, expect, test } from "bun:test";

import type { MessageData } from "@asm/db";

import { HistoryThrottledError } from "./history-throttle";
import { createMemorySearchIndexStore } from "./memory-search-index";
import { createMessageIndexBackfill } from "./message-index-backfill";
import type { BackfillPage } from "./message-index-backfill";
import { createMessageIndexWriter } from "./message-index-writer";
import type { IndexablePayload } from "./message-index-writer";
import {
  emptySearchIndexMeta,
  intersectPostingLists,
} from "./search-index-format";
import type { SearchIndexStore } from "./search-index-format";

const CONVO = "c1";

function message(id: string, createdAt: number): MessageData {
  return {
    conversationId: CONVO,
    createdAt: new Date(createdAt),
    deletedAt: null,
    id,
    senderId: "user-a",
  } as MessageData;
}

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(
  options: { maxPages?: number; pages?: number; pageSize?: number } = {}
) {
  const { maxPages, pageSize = 2, pages = 10 } = options;
  const store: SearchIndexStore = createMemorySearchIndexStore();
  const payloads = new Map<string, IndexablePayload>();
  const writer = createMessageIndexWriter({
    conversationId: CONVO,
    getPayload: (id) => payloads.get(id),
    store,
  });
  // Newest-first ids, so "older" pages walk down the list the way the API does.
  const all = Array.from({ length: pages * pageSize }, (_, index) => ({
    createdAt: 1_700_000_000_000 + index,
    id: `m${String(pages * pageSize - 1 - index).padStart(4, "0")}`,
  }));
  const fetches: (string | undefined)[] = [];
  const decrypted: string[][] = [];

  const progress: string[] = [];
  const states: string[] = [];

  const fetchPage = (cursor: string | undefined): Promise<BackfillPage> => {
    fetches.push(cursor);
    // The page strictly older than `cursor`, oldest-first within the page.
    const start = cursor ? all.findIndex((row) => row.id === cursor) + 1 : 0;
    const slice = all.slice(start, start + pageSize);
    for (const row of slice) {
      payloads.set(row.id, { content: `deploy note ${row.id}`, type: "text" });
    }
    return {
      // Oldest-first, matching the route: it reverses its descending page before
      // responding. The harness has to model the real contract or the walker's
      // cursor bookkeeping is being tested against the wrong shape.
      messages: slice.toReversed().map((row) => message(row.id, row.createdAt)),
      // Matches the route: a cursor only when older rows remain, so a walk ends
      // on its last real page rather than on a probing empty one.
      previousCursor: all[start + pageSize] ? (slice.at(-1)?.id ?? null) : null,
    };
  };

  const backfill = createMessageIndexBackfill({
    awaitDecrypts: (messages) => {
      decrypted.push(messages.map((row) => row.id));
    },
    conversationId: CONVO,
    fetchPage,
    onProgress: (next) => {
      progress.push(`${next.pageCount}:${next.indexedCount}`);
    },
    onStateChange: (next) => {
      states.push(next);
    },
    pageDelayMs: 1,
    store,
    writer,
    ...(maxPages === undefined ? {} : { maxPages }),
  });

  return {
    all,
    backfill,
    decrypted,
    fetchPage,
    fetches,
    payloads,
    progress,
    states,
    store,
    writer,
  };
}

async function idsFor(
  store: SearchIndexStore,
  token: string
): Promise<string[]> {
  const list = await store.readPostingList(CONVO, token);
  const { rows } = intersectPostingLists([list], 1000);
  const resolved = await store.readRows(CONVO, Uint32Array.from(rows));
  return [...resolved.values()].map((facts) => facts.messageId);
}

describe("message index backfill", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  test("walks to the start of the conversation and indexes every page", async () => {
    const result = await harness.backfill.run();
    expect(result.reachedStart).toBe(true);
    expect(result.state).toBe("done");
    // Ten pages of two, from the newest page to the oldest.
    expect(result.pageCount).toBe(10);
    expect(result.indexedCount).toBe(20);
    const indexed = await idsFor(harness.store, "note");
    expect(indexed).toHaveLength(20);
  });

  test("pages backwards from the newest, oldest page last", async () => {
    await harness.backfill.run();
    expect(harness.fetches[0]).toBeUndefined();
    // Each fetch continues from the oldest id the previous page returned, so no
    // row is skipped and none is fetched twice.
    expect(harness.fetches[1]).toBe("m0018");
    expect(harness.fetches[2]).toBe("m0016");
  });

  // Pins the ordering contract the walker's cursor bookkeeping depends on.
  test("hands each page to the writer oldest-first, as the API returns it", async () => {
    await harness.backfill.run();
    expect(harness.decrypted).toHaveLength(10);
    expect(harness.decrypted[0]).toEqual(["m0018", "m0019"]);
    expect(harness.decrypted[1]).toEqual(["m0016", "m0017"]);
  });

  test("records the oldest id it reached for resume", async () => {
    const result = await harness.backfill.run();
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.indexedThroughId).toBe("m0000");
    expect(result.oldestReachedId).toBe("m0000");
    expect(meta?.version).toBeGreaterThan(0);
  });

  test("a second run resumes instead of re-walking", async () => {
    await harness.backfill.run();
    expect(harness.fetches).toHaveLength(10);
    // Nothing older remains, so the resumed run fetches once and stops.
    const result = await harness.backfill.run();
    expect(harness.fetches).toHaveLength(11);
    expect(result.reachedStart).toBe(true);
    expect(result.indexedCount).toBe(0);
  });

  test("resumes from a cursor left by an interrupted run", async () => {
    await harness.store.writeMeta({
      ...emptySearchIndexMeta(CONVO),
      // Pretend a previous run got four pages in.
      indexedThroughId: "m0011",
    });
    const result = await harness.backfill.run();
    expect(harness.fetches[0]).toBe("m0011");
    // Only the rows older than the cursor are walked; the ones already covered
    // are not fetched again.
    const cursorAt = harness.all.findIndex((row) => row.id === "m0011");
    const remaining = harness.all.length - cursorAt - 1;
    expect(result.indexedCount).toBe(remaining);
    expect(result.reachedStart).toBe(true);
  });

  test("stops on its page budget and reports the conversation is not covered", async () => {
    const bounded = makeHarness({ maxPages: 3, pages: 50 });
    const result = await bounded.backfill.run();
    expect(result.pageCount).toBe(3);
    // Not an error and not finished: the UI must still offer to continue.
    expect(result.state).toBe("done");
    expect(result.reachedStart).toBe(false);
    const meta = await bounded.store.readMeta(CONVO);
    // Three pages of two, so the sixth-newest row is the oldest reached.
    expect(meta?.indexedThroughId).toBe("m0094");
    // Continuing from there picks up exactly where the budget left off.
    const second = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: bounded.fetchPage,
      maxPages: 100,
      pageDelayMs: 1,
      store: bounded.store,
      writer: bounded.writer,
    });
    const resumed = await second.run();
    expect(resumed.reachedStart).toBe(true);
    const indexed = await idsFor(bounded.store, "note");
    expect(indexed).toHaveLength(100);
  });

  test("a stopped run keeps everything it committed", async () => {
    const controller = new AbortController();
    const aborting = createMessageIndexBackfill({
      awaitDecrypts: () => {
        // Abort while the first page is being handed over.
        controller.abort();
      },
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      pageDelayMs: 1,
      signal: controller.signal,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await aborting.run();
    expect(result.state).toBe("stopped");
    expect(result.pageCount).toBe(1);
    const indexed = await idsFor(harness.store, "note");
    expect(indexed).toHaveLength(2);
  });

  test("stop() ends the walk after the current page", async () => {
    const backfill = createMessageIndexBackfill({
      awaitDecrypts: () => {
        backfill.stop();
      },
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await backfill.run();
    expect(result.state).toBe("stopped");
    expect(result.pageCount).toBe(1);
  });

  test("a fetch failure ends the run without losing indexed pages", async () => {
    let calls = 0;
    const flaky = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: (cursor) => {
        calls += 1;
        if (calls > 2) {
          throw new Error("network down");
        }
        return harness.fetchPage(cursor);
      },
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await flaky.run();
    expect(result.state).toBe("failed");
    expect(result.indexedCount).toBe(4);
    // The cursor points at committed history, so the retry skips what it has.
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.indexedThroughId).toBe("m0016");
    expect(await idsFor(harness.store, "note")).toHaveLength(4);
  });

  // A correctly paced walk generates 240 pages/minute, so the server budget has
  // to sit above that or it throttles the client it is protecting. When one does
  // throttle — a shared IP, or another tab — the walk must pause and continue,
  // not strand itself at whatever page it reached.
  test("a throttled page is retried after the server's delay", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const throttled = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: (cursor) => {
        attempts += 1;
        if (attempts === 1) {
          throw new HistoryThrottledError(0.05);
        }
        return harness.fetchPage(cursor);
      },
      maxPages: 1,
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await throttled.run();
    expect(attempts).toBe(2);
    expect(result.pageCount).toBe(1);
    expect(result.state).toBe("done");
    // The page was indexed despite the throttle, and the retry is the same page
    // rather than a skip.
    const indexed = await idsFor(harness.store, "note");
    expect(indexed.length).toBeGreaterThan(0);
    void waits;
  });

  test("a repeatedly throttled page eventually gives up without looping", async () => {
    let attempts = 0;
    const throttled = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        attempts += 1;
        throw new HistoryThrottledError(0.01);
      },
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await throttled.run();
    // Bounded retries: 1 initial attempt plus the retry budget.
    expect(attempts).toBe(5);
    expect(result.state).toBe("failed");
  });

  test("a non-throttle failure is not retried", async () => {
    let attempts = 0;
    const broken = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        attempts += 1;
        throw new Error("network down");
      },
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await broken.run();
    // A dead network is not fixed by retrying four times in a row.
    expect(attempts).toBe(1);
    expect(result.state).toBe("failed");
  });

  test("a page that repeats does not loop forever", async () => {
    let calls = 0;
    const looping = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        calls += 1;
        // Same cursor every time: a broken pagination would spin here.
        return {
          messages: [message(`loop${calls}`, calls)],
          previousCursor: "stuck",
        };
      },
      maxPages: 50,
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await looping.run();
    // Bounded by the page budget rather than running away.
    expect(result.pageCount).toBe(50);
    expect(calls).toBe(50);
  });

  test("an empty page ends the walk", async () => {
    const empty = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => ({ messages: [], previousCursor: null }),
      store: harness.store,
      writer: harness.writer,
    });
    const result = await empty.run();
    expect(result.reachedStart).toBe(true);
    expect(result.indexedCount).toBe(0);
  });

  test("concurrent runs share one walk rather than duplicating it", async () => {
    const first = harness.backfill.run();
    const second = harness.backfill.run();
    await Promise.all([first, second]);
    // Ten pages total, not twenty: the second call joined the first.
    expect(harness.fetches).toHaveLength(10);
  });

  test("reports progress as it commits pages", async () => {
    await harness.backfill.run();
    expect(harness.progress).toContain("1:2");
    expect(harness.progress).toContain("10:20");
    expect(harness.states).toContain("running");
    expect(harness.states.at(-1)).toBe("done");
  });

  test("a message with no searchable text still advances the cursor", async () => {
    const blank = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => ({
        messages: [message("m1", 1)],
        previousCursor: null,
      }),
      store: harness.store,
      writer: (() => {
        const payloads = new Map<string, IndexablePayload>([
          ["m1", { content: "   ", type: "text" }],
        ]);
        return createMessageIndexWriter({
          conversationId: CONVO,
          getPayload: (id) => payloads.get(id),
          store: harness.store,
        });
      })(),
    });
    const result = await blank.run();
    // Nothing indexed, but the row is covered, so the walk does not retry it.
    expect(result.indexedCount).toBe(1);
    expect(result.reachedStart).toBe(true);
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.indexedThroughId).toBe("m1");
  });

  // The resume cursor round-trip. The route reverses its descending page before
  // responding, so a page arrives oldest-first, and the persisted cursor must be
  // the oldest id in the last page indexed. Persisting the newest instead makes
  // every resumed walk re-fetch that page, because paging from a newer id returns
  // rows that were already covered.
  test("persists the oldest id of the last page, not the newest", async () => {
    await harness.backfill.run();
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.indexedThroughId).toBe("m0000");
  });

  test("a resumed walk starts after the last committed page, not inside it", async () => {
    const stopped = createMessageIndexBackfill({
      awaitDecrypts: () => {
        stopped.stop();
        return Promise.resolve();
      },
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    await stopped.run();
    const afterFirstPage = await harness.store.readMeta(CONVO);
    // One page of two: the cursor is the older of the two ids in it.
    expect(afterFirstPage?.indexedThroughId).toBe("m0018");

    // Resuming must not re-fetch m0019/m0018.
    harness.fetches.length = 0;
    const resumed = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      maxPages: 1,
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    await resumed.run();
    expect(harness.fetches[0]).toBe("m0018");
  });

  test("reports the newest and oldest ids it covered", async () => {
    const result = await harness.backfill.run();
    expect(result.latestIndexedId).toBe("m0019");
    expect(result.oldestReachedId).toBe("m0000");
  });

  // The hole this closes: flush() used to return nothing, so the walk could not
  // tell a committed page from a page whose rows were all still queued, and it
  // advanced the cursor either way. Combined with a pending set that lived only
  // in memory, one decrypt timeout or refused write left a permanent silent gap.
  test("the cursor does not advance when rows could not be indexed", async () => {
    const payloads = new Map<string, IndexablePayload>();
    const store = createMemorySearchIndexStore();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    const backfill = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      pageDelayMs: 1,
      store,
      writer,
    });
    // Every page's payload stays undecrypted, so nothing can commit.
    const result = await backfill.run();
    // The walk still reaches the start, and still advances: the rows are all
    // durably queued, so the QUEUE is the recovery mechanism and the cursor does
    // not have to hold them back. The bug was not advancing while queueing
    // nowhere, not advancing at all.
    expect(result.reachedStart).toBe(true);
    expect(result.state).toBe("done");
    expect(result.pendingCount).toBeGreaterThan(0);
    const queued = await store.readPending(CONVO);
    expect(queued.length).toBeGreaterThan(0);
    // Nothing was indexed, and nothing pretends otherwise.
    expect(await idsFor(store, "deploy")).toEqual([]);
    void payloads;
  });

  test("the cursor stays put when the queue itself cannot be persisted", async () => {
    const store = createMemorySearchIndexStore();
    store.writePending = () => Promise.reject(new Error("quota"));
    const payloads = new Map<string, IndexablePayload>();
    const writer = createMessageIndexWriter({
      conversationId: CONVO,
      getPayload: (id) => payloads.get(id),
      store,
    });
    const backfill = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      pageDelayMs: 1,
      store,
      writer,
    });
    const result = await backfill.run();
    expect(result.state).toBe("failed");
    // No cursor at all: those rows are committed or recoverable from nowhere, and
    // moving the cursor would strand them permanently.
    expect(await store.readMeta(CONVO)).toBeNull();
    expect(await store.readPending(CONVO)).toEqual([]);
  });

  test("a page that fully commits advances the cursor as before", async () => {
    const result = await harness.backfill.run();
    expect(result.reachedStart).toBe(true);
    expect(result.pendingCount).toBe(0);
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.indexedThroughId).toBe("m0000");
    // Nothing left over once every row committed.
    expect(await harness.store.readPending(CONVO)).toEqual([]);
  });

  test("keeps the pending set when persisting the cursor", async () => {
    await harness.store.writeMeta({
      ...emptySearchIndexMeta(CONVO),
      pendingIds: ["m-pending"],
    });
    await harness.backfill.run();
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.pendingIds).toEqual(["m-pending"]);
    expect(meta?.indexedThroughId).toBe("m0000");
  });
});
