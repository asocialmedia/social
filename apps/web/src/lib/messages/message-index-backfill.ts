// Backfills a conversation's older history into the local search index.
//
// Until this exists, search only covers history the user happened to scroll
// through: the writer indexes whatever the transcript holds, so a message nobody
// ever scrolled to is invisible to search. This walks the rest of the
// conversation backwards, page by page, and feeds each page to the same writer
// the transcript already uses, so one index serves both.
//
// Properties this file exists to guarantee:
//
// - Resumable. The oldest id reached is persisted to meta after every committed
//   page, so closing the tab mid-walk resumes where it stopped instead of
//   starting over. An interrupted walk is the common case, not the exception.
// - Bounded. A single run walks at most `maxPages` pages and then yields, so a
//   200k-message conversation cannot turn into one request storm. The caller
//   starts another run when it wants to keep going.
// - Abortable. Closing search, switching conversations, or losing the network
//   stops the walk between pages, and the cursor reflects only committed pages.
// - Paced. One page in flight at a time with a delay between pages, because this
//   walks the oldest page a user may have opened years ago and has no business
//   saturating the API.
// - Degrading. A page that cannot be fetched stops the walk and keeps everything
//   indexed so far. Messages that cannot be decrypted are still counted as
//   covered, because the cursor means "we have seen this row", not "this row is
//   searchable": the writer persists those rows to a durable queue and retries
//   them.
//
//   That distinction is the whole reason the cursor is trustworthy. Advancing past
//   a page is safe only because every row in it is either committed or durably
//   queued. When the QUEUE ITSELF cannot be written, those rows are recoverable
//   from nowhere, so the cursor must not move and the walk stops.

import type { MessageData } from "@asm/db";

import { isHistoryThrottled } from "./history-throttle";
import type { MessageIndexWriter } from "./message-index-writer";
import { emptySearchIndexMeta } from "./search-index-format";
import type { SearchIndexStore } from "./search-index-format";

// One page of history, oldest-first, with the cursor to continue from.
export interface BackfillPage {
  messages: MessageData[];
  previousCursor: string | null;
}

export type BackfillState = "done" | "failed" | "idle" | "running" | "stopped";

export interface BackfillProgress {
  // Pages committed by this run.
  pageCount: number;
  // True once the walk reached the oldest message, so there is no older history
  // left to index. The UI uses this to stop offering "index older messages".
  reachedStart: boolean;
  // Newest id this run indexed, for the progress line.
  latestIndexedId: string | null;
  // Oldest id reached, persisted so the next run resumes here.
  oldestReachedId: string | null;
  // Messages handed to the writer by this run.
  indexedCount: number;
  // Rows this run could not index: payload not decrypted yet, or a refused write.
  // Persisted, so they are recovered later rather than lost.
  pendingCount: number;
  state: BackfillState;
}

export interface MessageIndexBackfillOptions {
  conversationId: string;
  // Resolves when the page's payloads are decrypted, or when the wait is given up
  // on. Injected so this module stays free of crypto and WebCrypto.
  awaitDecrypts: (messages: MessageData[]) => Promise<void>;
  // Fetches one page older than `cursor`. `cursor` is undefined for the first
  // page, which starts from the newest indexed message.
  fetchPage: (cursor: string | undefined) => Promise<BackfillPage>;
  onProgress?: (progress: BackfillProgress) => void;
  onStateChange?: (state: BackfillState) => void;
  // Aborts the walk between pages. Already-committed pages stay indexed.
  signal?: AbortSignal;
  store: SearchIndexStore;
  writer: MessageIndexWriter;
  // Delay between pages. Pacing is a politeness budget, not a performance knob:
  // the walk is hundreds of requests over a conversation that is not time-bound.
  pageDelayMs?: number;
  maxPages?: number;
}

export interface MessageIndexBackfill {
  progress: () => BackfillProgress;
  // Runs until the start of the conversation, the page budget, or an abort.
  // Concurrent calls share the in-flight run rather than starting a second walk.
  run: () => Promise<BackfillProgress>;
  state: () => BackfillState;
  stop: () => void;
}

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_PAGE_DELAY_MS = 250;
// How many times one page may be retried after the server throttles the walk.
// Retrying is the difference between a walk that pauses and one that dies: a
// shared IP or a burst from another tab can throttle a perfectly polite walk.
const MAX_THROTTLE_RETRIES = 4;

const sleep = (ms: number) =>
  // oxlint-disable-next-line promise/avoid-new -- a timer has no async/await form
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createMessageIndexBackfill(
  options: MessageIndexBackfillOptions
): MessageIndexBackfill {
  const {
    awaitDecrypts,
    conversationId,
    fetchPage,
    onProgress,
    onStateChange,
    store,
    writer,
  } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const pageDelayMs = options.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;

  let state: BackfillState = "idle";
  let inFlight: Promise<BackfillProgress> | null = null;
  let stopped = false;
  let progress: BackfillProgress = {
    indexedCount: 0,
    latestIndexedId: null,
    oldestReachedId: null,
    pageCount: 0,
    pendingCount: 0,
    reachedStart: false,
    state: "idle",
  };

  function setState(next: BackfillState): void {
    state = next;
    progress = { ...progress, state: next };
    onStateChange?.(next);
  }

  function report(patch: Partial<BackfillProgress>): void {
    progress = { ...progress, ...patch };
    onProgress?.(progress);
  }

  // The cursor only ever moves forward through committed pages, so a failed or
  // aborted page leaves the persisted position pointing at real indexed history.
  async function persistCursor(oldestReachedId: string | null): Promise<void> {
    try {
      const existing =
        (await store.readMeta(conversationId)) ??
        emptySearchIndexMeta(conversationId);
      await store.writeMeta({
        ...existing,
        indexedThroughId: oldestReachedId,
        updatedAt: Date.now(),
      });
    } catch {
      // Storage refused. The walk still indexed this run's pages; the cursor is
      // a resume aid, and losing it costs one redundant walk, not correctness.
    }
  }

  async function walk(
    signal: AbortSignal | undefined
  ): Promise<BackfillProgress> {
    setState("running");
    let cursor: string | undefined;
    try {
      const meta = await store.readMeta(conversationId);
      cursor = meta?.indexedThroughId ?? undefined;
    } catch {
      // Unreadable meta means no resume point; walk from the newest indexed row.
      cursor = undefined;
    }

    let pages = 0;
    let indexed = 0;
    let pending = 0;
    let latestIndexedId: string | null = null;
    let oldestReachedId = cursor ?? null;
    let reachedStart = false;

    // Sequential by design: one page in flight at a time, each committed before
    // the next is requested. That is the pacing this walk exists to provide.
    // oxlint-disable no-await-in-loop -- one page in flight at a time, on purpose
    for (let page = 0; page < maxPages; page += 1) {
      if (stopped || signal?.aborted) {
        break;
      }
      let fetched: BackfillPage | null = null;
      for (let attempt = 0; attempt <= MAX_THROTTLE_RETRIES; attempt += 1) {
        try {
          fetched = await fetchPage(cursor);
          break;
        } catch (error) {
          if (!isHistoryThrottled(error)) {
            // A page that cannot be fetched ends this run with everything
            // indexed so far intact. The next run retries from the last committed
            // cursor.
            setState("failed");
            report({
              indexedCount: indexed,
              latestIndexedId,
              pageCount: pages,
            });
            return progress;
          }
          if (attempt === MAX_THROTTLE_RETRIES) {
            setState("failed");
            report({
              indexedCount: indexed,
              latestIndexedId,
              pageCount: pages,
            });
            return progress;
          }
          // Wait exactly as long as the server asked. The walk is resumable, so
          // giving up is always safe, but pausing keeps a throttled walk
          // progressing instead of stranding it at whatever page it reached.
          await sleep(error.retryAfterSeconds * 1000);
        }
      }
      if (!fetched) {
        setState("failed");
        report({ indexedCount: indexed, latestIndexedId, pageCount: pages });
        return progress;
      }

      const { messages, previousCursor } = fetched;
      if (messages.length > 0) {
        // Decrypt first: the writer can only index a row whose payload it can
        // read, and handing it undecrypted rows would just queue them as pending
        // and retry them against a transcript that will never hold them.
        await awaitDecrypts(messages);
        writer.consider(messages);
        const result = await writer.flush();
        indexed += messages.length;
        pending = result.stillPending.length;
        if (result.failed) {
          // The rows committed or were queued, but the QUEUE could not be
          // persisted, so any row that did not commit is recoverable from
          // nowhere. Moving the cursor would strand it permanently, so the walk
          // stops here with everything above this page intact.
          setState("failed");
          report({
            indexedCount: indexed,
            latestIndexedId,
            pageCount: pages,
            pendingCount: pending,
          });
          return progress;
        }
        // A page arrives oldest-first (the route reverses its descending page
        // before responding), so the head is the oldest id and the tail the
        // newest. Getting this backwards persists a resume cursor pointing at
        // the newest row of the last page, which makes every resumed walk
        // re-fetch that whole page.
        //
        // Pages arrive newest-page-first, so the newest id this run covered came
        // from the first page: assigning it every time would leave it pointing at
        // the newest row of the OLDEST page, which is the least useful number
        // the progress line could report.
        latestIndexedId ??= messages.at(-1)?.id ?? null;
        oldestReachedId = messages[0]?.id ?? oldestReachedId;
      }

      pages += 1;
      report({
        indexedCount: indexed,
        latestIndexedId,
        oldestReachedId,
        pageCount: pages,
        pendingCount: pending,
      });
      // Persisted per page, not per run: an interrupted walk must not redo the
      // pages it already paid for. Safe now precisely because every row in the
      // page is committed or durably queued.
      await persistCursor(oldestReachedId);

      if (!previousCursor || messages.length === 0) {
        // No older page, or a page that repeated: either way there is nothing
        // older to fetch and the walk is complete.
        reachedStart = true;
        break;
      }
      cursor = previousCursor;
      if (page < maxPages - 1) {
        await sleep(pageDelayMs);
      }
    }

    // A run that stopped on its page budget is not finished, even though it
    // ended without error. That is what `reachedStart` distinguishes: the UI
    // keeps offering "index older messages" until it is true.
    // oxlint-enable no-await-in-loop
    setState(stopped || signal?.aborted ? "stopped" : "done");
    report({
      indexedCount: indexed,
      latestIndexedId,
      oldestReachedId,
      pendingCount: pending,
      reachedStart,
    });
    return progress;
  }

  return {
    progress: () => progress,

    async run() {
      const current = inFlight;
      if (current) {
        return await current;
      }
      stopped = false;
      const started = (async () => {
        try {
          return await walk(options.signal);
        } finally {
          inFlight = null;
        }
      })();
      inFlight = started;
      return await started;
    },

    state: () => state,

    stop() {
      stopped = true;
    },
  };
}
