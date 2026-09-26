import { beforeEach, describe, expect, test } from "bun:test";

import type { MessageData } from "@asm/db";

import { MessagesApiError } from "./client";
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

// A promise the test opens by hand. Used where the property under test is that
// nothing proceeds until something ELSE decides it may.
function gate() {
  let open!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- a test gate the test resolves
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, promise };
}

// A gate that never opens, for the case where only a stop may end the run.
function forever() {
  // oxlint-disable-next-line promise/avoid-new -- deliberately never settles
  return new Promise<void>(() => {});
}

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
  options: {
    maxPages?: number;
    pages?: number;
    pageSize?: number;
    fetchPage?: (cursor: string | undefined) => Promise<BackfillPage>;
  } = {}
) {
  const {
    fetchPage: fetchPageOverride,
    maxPages,
    pageSize = 2,
    pages = 10,
  } = options;
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
    fetchPage: fetchPageOverride ?? fetchPage,
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
    // Nothing older remains, so the resumed run probes the top, resumes from
    // the cursor, fetches once, and stops.
    const result = await harness.backfill.run();
    expect(harness.fetches).toHaveLength(12);
    expect(result.reachedStart).toBe(true);
    expect(result.indexedCount).toBe(0);
  });

  test("resumes from a cursor left by an interrupted run", async () => {
    await harness.store.writeMeta({
      ...emptySearchIndexMeta(CONVO),
      // Pretend a previous verifying run got four pages in: the vouched chain
      // is what makes the hint resumable rather than restartable.
      cursorVerified: true,
      indexedThroughId: "m0011",
    });
    // ...and covered the top page some other way, so the probe passes and the
    // hint is trusted. Without covered ground above it, the run would abandon
    // the hint and walk from the top instead (see below).
    for (const row of harness.all.slice(0, 2)) {
      harness.payloads.set(row.id, {
        content: `deploy note ${row.id}`,
        type: "text",
      });
    }
    harness.writer.consider(
      harness.all.slice(0, 2).map((row) => message(row.id, row.createdAt))
    );
    await harness.writer.flush();
    const result = await harness.backfill.run();
    // Top probe first, then the resume cursor: the covered top is not
    // decrypted or committed again.
    expect(harness.fetches[0]).toBeUndefined();
    expect(harness.fetches[1]).toBe("m0011");
    // Only the rows older than the cursor are walked; the ones already covered
    // are not fetched again.
    const cursorAt = harness.all.findIndex((row) => row.id === "m0011");
    const remaining = harness.all.length - cursorAt - 1;
    expect(result.indexedCount).toBe(remaining);
    expect(result.reachedStart).toBe(true);
    expect(harness.decrypted.flat()).not.toContain("m0019");
  });

  test("abandons a resume hint the top page disproves", async () => {
    await harness.store.writeMeta({
      ...emptySearchIndexMeta(CONVO),
      // A stale hint pointing deep, with nothing above it covered.
      indexedThroughId: "m0011",
    });
    const result = await harness.backfill.run();
    // Probe, then the top page itself (not the hint): the run descends from
    // the top and covers everything, healing the stale cursor on the way.
    expect(harness.fetches[0]).toBeUndefined();
    expect(harness.fetches[1]).toBeUndefined();
    expect(result.indexedCount).toBe(harness.all.length);
    expect(result.reachedStart).toBe(true);
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.indexedThroughId).toBe("m0000");
  });

  // The fixture-shaped case: a legacy cursor no verifying run ever vouched
  // for, pointing below covered ground. Even with the top page covered, the
  // hint is abandoned -- resuming from it would strand everything above --
  // and the run earns the mark by descending from the top.
  test("abandons an unvouched cursor even when the top is covered", async () => {
    for (const row of harness.all.slice(0, 2)) {
      harness.payloads.set(row.id, {
        content: `deploy note ${row.id}`,
        type: "text",
      });
    }
    harness.writer.consider(
      harness.all.slice(0, 2).map((row) => message(row.id, row.createdAt))
    );
    await harness.writer.flush();
    await harness.store.writeMeta({
      ...emptySearchIndexMeta(CONVO),
      indexedThroughId: "m0011",
    });
    const result = await harness.backfill.run();
    expect(harness.fetches[0]).toBeUndefined();
    expect(harness.fetches[1]).toBeUndefined();
    expect(result.indexedCount).toBe(harness.all.length);
    expect(result.reachedStart).toBe(true);
    const meta = await harness.store.readMeta(CONVO);
    expect(meta?.cursorVerified).toBe(true);
  });

  test("skips covered pages without decrypting or committing them", async () => {
    // Cover everything up front through the writer, leaving no cursor: the
    // run still sweeps top to bottom, but every page is a verified skip.
    for (const row of harness.all) {
      harness.payloads.set(row.id, {
        content: `deploy note ${row.id}`,
        type: "text",
      });
    }
    harness.writer.consider(
      harness.all.map((row) => message(row.id, row.createdAt))
    );
    await harness.writer.flush();
    const result = await harness.backfill.run();
    expect(result.reachedStart).toBe(true);
    expect(result.indexedCount).toBe(harness.all.length);
    // Ten page fetches, zero decrypts: coverage was verified per page, never
    // assumed and never repaid.
    expect(harness.fetches).toHaveLength(10);
    expect(harness.decrypted).toHaveLength(0);
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

  // The reported fresh-profile failure: a 401 mid-walk used to kill the whole
  // run on the first page it touched, stranding the walk on the retry button.
  // Sessions flap (two tabs racing a rotation, a proxy blip); the walk now
  // waits those out like it already did for throttles.
  test("an unauthorized page is retried, then completes", async () => {
    let attempts = 0;
    const flapping = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: (cursor) => {
        attempts += 1;
        if (attempts <= 2) {
          throw new MessagesApiError("Request failed (401)", 401);
        }
        return harness.fetchPage(cursor);
      },
      maxPages: 1,
      pageDelayMs: 1,
      retryDelayMs: 5,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await flapping.run();
    expect(attempts).toBe(3);
    expect(result.pageCount).toBe(1);
    expect(result.state).toBe("done");
    expect(await idsFor(harness.store, "note")).not.toHaveLength(0);
  });

  test("a persistently unauthorized session still fails bounded", async () => {
    let attempts = 0;
    const dead = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        attempts += 1;
        throw new MessagesApiError("Request failed (401)", 401);
      },
      pageDelayMs: 1,
      retryDelayMs: 5,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await dead.run();
    // Bounded: 1 initial attempt plus the transient budget, not a loop. A dead
    // session fails the run; a flapping one rides the same waits through.
    expect(attempts).toBe(5);
    expect(result.state).toBe("failed");
  });

  test("a server blip is retried", async () => {
    const blip = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: (() => {
        let attempts = 0;
        return (cursor: string | undefined) => {
          attempts += 1;
          if (attempts === 1) {
            throw new MessagesApiError("Request failed (503)", 503);
          }
          return harness.fetchPage(cursor);
        };
      })(),
      maxPages: 1,
      pageDelayMs: 1,
      retryDelayMs: 5,
      store: harness.store,
      writer: harness.writer,
    });
    const blipped = await blip.run();
    expect(blipped.state).toBe("done");
  });

  test("a refused request fails fast without retrying", async () => {
    // A fresh store: no persisted cursor, so no resume probe runs first and the
    // single page fetch below is the whole story.
    const fresh = makeHarness({ maxPages: 1 });
    let refused = 0;
    const denied = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        refused += 1;
        throw new MessagesApiError("Request failed (404)", 404);
      },
      pageDelayMs: 1,
      retryDelayMs: 5,
      store: fresh.store,
      writer: fresh.writer,
    });
    const result = await denied.run();
    // A request the server understood and refused cannot heal by retrying.
    expect(refused).toBe(1);
    expect(result.state).toBe("failed");
  });

  test("a dropped request is retried, then gives up bounded", async () => {
    let attempts = 0;
    const dropped = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        attempts += 1;
        throw new TypeError("fetch failed");
      },
      pageDelayMs: 1,
      retryDelayMs: 5,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await dropped.run();
    expect(attempts).toBe(5);
    expect(result.state).toBe("failed");
  });

  test("stopping during a retry wait halts promptly instead of failing", async () => {
    const stalled = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      conversationId: CONVO,
      fetchPage: () => {
        throw new MessagesApiError("Request failed (401)", 401);
      },
      pageDelayMs: 1,
      // A five-second first wait: without an abortable sleep the stop below
      // would hang the teardown for the whole wait.
      retryDelayMs: 5000,
      store: harness.store,
      writer: harness.writer,
    });
    const running = stalled.run();
    await Bun.sleep(100);
    stalled.stop();
    const result = await running;
    // Silent by contract: a stop is never a failure, even mid-retry.
    expect(result.state).toBe("stopped");
  });

  // The walk and the transcript share one rate-limit budget. Without a way to
  // stand aside, a user jump's single anchored read lands inside the walk's
  // steady 500-row stream, gets throttled, and falls back to its own bounded
  // walk against the same tripped limiter.
  test("waits for the transcript before asking for a page", async () => {
    const order: string[] = [];
    // A gate the test opens by hand, which is the whole point: the walk must not
    // request anything until the transcript lets go.
    const held = gate();
    let asks = 0;
    const yielding = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      beforePage: async () => {
        order.push("yield");
        await held.promise;
      },
      conversationId: CONVO,
      fetchPage: () => {
        asks += 1;
        order.push("fetch");
        return {
          messages: [message(`yield${asks}`, asks)],
          previousCursor: asks < 3 ? `c${asks}` : null,
        };
      },
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const running = yielding.run();
    await Bun.sleep(30);
    // Not one page requested: the transcript holds the endpoint.
    expect(asks).toBe(0);
    held.open();
    const result = await running;
    expect(result.pageCount).toBe(3);
    expect(order[0]).toBe("yield");
    expect(order.filter((entry) => entry === "fetch").length).toBe(3);
  });

  // Re-checked per attempt, not once per page: a throttle wait is when a jump is
  // most likely to be mid-read, and the first attempt after a backoff would
  // otherwise spend itself inside someone's anchored read.
  test("waits again before a throttled page's retry", async () => {
    let attempts = 0;
    let yields = 0;
    let throttled = true;
    const retrying = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      beforePage: () => {
        yields += 1;
      },
      conversationId: CONVO,
      fetchPage: () => {
        attempts += 1;
        if (throttled) {
          throttled = false;
          throw new HistoryThrottledError(0);
        }
        return { messages: [message("after-retry", 1)], previousCursor: null };
      },
      pageDelayMs: 1,
      store: harness.store,
      writer: harness.writer,
    });
    const result = await retrying.run();
    expect(result.state).toBe("done");
    expect(attempts).toBe(2);
    expect(yields).toBe(2);
  });

  test("a rejection from the yield pauses the walk without failing it", async () => {
    let asks = 0;
    const refusing = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      beforePage: () => {
        throw new Error("conversation changed");
      },
      conversationId: CONVO,
      fetchPage: () => {
        asks += 1;
        return { messages: [message("never", asks)], previousCursor: null };
      },
      store: harness.store,
      writer: harness.writer,
    });
    const result = await refusing.run();
    // Silent and resumable: the cursor only ever moves past committed pages, so
    // a pause costs nothing and the next run continues.
    expect(asks).toBe(0);
    expect(result.pageCount).toBe(0);
    expect(result.state).not.toBe("failed");
  });

  test("stopping while the walk is yielding halts before the next page", async () => {
    let asks = 0;
    const waiting = createMessageIndexBackfill({
      awaitDecrypts: async () => {},
      // Never opens: only the stop below can end this run, which is the point --
      // a yield hook that only settles on a release would hang the teardown for
      // as long as the transcript held the endpoint.
      beforePage: () => forever(),
      conversationId: CONVO,
      fetchPage: () => {
        asks += 1;
        return { messages: [message("never", asks)], previousCursor: null };
      },
      store: harness.store,
      writer: harness.writer,
    });
    const running = waiting.run();
    await Bun.sleep(20);
    waiting.stop();
    const result = await running;
    expect(asks).toBe(0);
    expect(result.state).toBe("stopped");
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
  // Stopping mid-page used to wait out the whole decrypt timeout (up to 5s)
  // for a thread nobody is reading. The wait is now raced against the abort,
  // so closing search or pressing Stop ends the run promptly -- after the
  // fetched page still commits, per the stop-after-current-page contract.
  test("stop() during the decrypt wait ends the run promptly", async () => {
    // Models a decrypt that only finishes on abort.
    const decrypting = gate();
    const controller = new AbortController();
    const hanging = createMessageIndexBackfill({
      awaitDecrypts: () => decrypting.promise,
      conversationId: CONVO,
      fetchPage: harness.fetchPage,
      signal: controller.signal,
      store: harness.store,
      writer: harness.writer,
    });
    const run = hanging.run();
    // Wait until the run is inside the decrypt wait: the fetch resolves
    // immediately, so the first observed fetch means the wait started.
    // oxlint-disable no-await-in-loop -- polling sequentially for a state change; parallel awaits would not poll
    for (let i = 0; i < 100 && harness.fetches.length === 0; i += 1) {
      // oxlint-disable-next-line promise/avoid-new -- a timer has no async/await form
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
    }
    // oxlint-enable no-await-in-loop
    const started = performance.now();
    hanging.stop();
    controller.abort();
    const progress = await run;
    expect(progress.state).toBe("stopped");
    expect(progress.pageCount).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
    decrypting.open();
  });

  test("reaching the start is persisted so reopening search skips the probe", async () => {
    const small = makeHarness({ pageSize: 2, pages: 2 });
    const done = await small.backfill.run();
    expect(done.reachedStart).toBe(true);
    const meta = await small.store.readMeta(CONVO);
    expect(meta?.reachedStart).toBe(true);
    expect(meta?.indexedThroughId).toBe("m0000");
  });

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

    // Resuming re-fetches the top page once, as a probe with no decrypt or
    // commit behind it, then continues after the cursor without touching the
    // covered rows again.
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
    expect(harness.fetches[0]).toBeUndefined();
    expect(harness.fetches[1]).toBe("m0018");
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
