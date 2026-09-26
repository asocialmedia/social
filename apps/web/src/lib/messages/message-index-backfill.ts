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
// - Self-verifying. The walk only ever descends, so a resume cursor pointing
//   below uncovered history would strand everything above it while reporting
//   steady progress. Each run therefore re-verifies the top page instead of
//   trusting the hint, and every page is checked for existing coverage before
//   any decrypt is spent on it: covered pages advance the cursor for the cost
//   of one fetch, and a run that verifies the bottom sets the flag that lets
//   future sessions skip the walk entirely.
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

import {
  isHistoryNetworkError,
  isHistoryServerError,
  isHistoryThrottled,
  isHistoryUnauthorized,
} from "./history-throttle";
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
  // Messages covered by this run: indexed just now, or verified as already
  // indexed and skipped past without spending decrypts or a commit on them.
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
  // Resolves before the walk is allowed to ask for a page.
  //
  // The walk and the transcript share one rate-limit budget, and on a fresh
  // device the walk owns it from the first keystroke: 500-row pages, 250ms apart,
  // while the user is trying to LAND on a search match through the same endpoint.
  // Nothing stopped the walk, so the user's single anchored read arrived into an
  // already-throttled budget, failed, and fell back to the bounded older-page
  // walk -- which then spent thirty unpaced requests against the same limiter and
  // reported the target unreachable. Waiting here is what makes a user-initiated
  // read cost one request instead of thirty.
  //
  // Optional, and a rejection is not a failure: the walk treats a throw the same
  // as an abort and abandons the page it had not requested yet, which is a pause
  // the next run continues from. The cursor only ever moves past committed pages,
  // so waiting cannot cost coverage.
  beforePage?: () => Promise<void>;
  // Fetches one page older than `cursor`. Omitted for the first page, which
  // starts from the newest message.
  fetchPage: (cursor?: string) => Promise<BackfillPage>;
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
  // Base wait between transient-failure retries; doubles per attempt up to 8x.
  // Exposed so tests can shrink a schedule that would otherwise stall the suite
  // for fifteen seconds proving that a dead session still fails bounded.
  retryDelayMs?: number;
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
// How many times one page may be retried after a transient failure that is not
// a throttle: an unauthorized response, a 5xx, or a dropped request. Sessions
// flap, servers deploy, dev servers restart under the walk -- failing the whole
// run on the first such page is what stranded fresh profiles on the retry
// button. The budget is deliberately the same shape as the throttle budget: a
// dead session still fails the run, just after a bounded wait rather than
// instantly. Anything else (400, 403, 404) fails fast: retrying a request the
// server understood and refused cannot heal it.
const MAX_TRANSIENT_RETRIES = 4;
// Waits between transient retries, growing so a flap has time to pass without
// hammering: base, doubled per attempt up to 8x, then the run fails.
const TRANSIENT_RETRY_DELAY_MS = 1000;

const sleep = (ms: number) =>
  // oxlint-disable-next-line promise/avoid-new -- a timer has no async/await form
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Sleep that a stop cuts short. Retry waits last seconds, and closing search or
// hiding the tab during one must halt the walk now rather than after the wait:
// without this, stopping during a 60s throttle pause leaves the teardown
// hanging for the full minute. Resolves true when the wait was abandoned.
// Listens to both signals the way waitForPageDecrypts does: the caller's abort
// (closing search, hiding the tab) and the run's own controller (stop()).
function sleepOrAbort(
  ms: number,
  signal: AbortSignal | undefined,
  runSignal: AbortSignal | undefined
): Promise<boolean> {
  if (signal?.aborted || runSignal?.aborted) {
    return Promise.resolve(true);
  }
  // oxlint-disable-next-line promise/avoid-new -- a timer has no async/await form
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      runSignal?.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    runSignal?.addEventListener("abort", onAbort, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

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
  const { beforePage } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const pageDelayMs = options.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;
  const retryDelayMs = options.retryDelayMs ?? TRANSIENT_RETRY_DELAY_MS;

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
  async function persistCursor(
    oldestReachedId: string | null,
    reachedStart: boolean,
    chainVerified: boolean
  ): Promise<void> {
    try {
      const existing =
        (await store.readMeta(conversationId)) ??
        emptySearchIndexMeta(conversationId);
      await store.writeMeta({
        ...existing,
        cursorVerified: chainVerified,
        indexedThroughId: oldestReachedId,
        reachedStart,
        updatedAt: Date.now(),
      });
    } catch {
      // Storage refused. The walk still indexed this run's pages; the cursor is
      // a resume aid, and losing it costs one redundant walk, not correctness.
    }
  }

  // One run's abort signal. `stop()` trips it so a walk waiting out the decrypt
  // timeout (up to 5s per page) ends promptly instead of finishing a wait for a
  // thread nobody is reading. Re-created per run: a stale aborted signal must
  // never cancel the next run.
  let runController: AbortController | null = null;

  // Waits for a page's decrypts. False means the wait was abandoned midway --
  // stopped or aborted while waiting -- as opposed to completed. Either way
  // the page itself still processes: "stop ends the walk after the current
  // page", so a stop abandons the WAIT, never the rows already fetched. The
  // decryptor itself cannot be cancelled; rows still unresolved after the
  // wait go through the writer's durable pending queue as usual.
  async function waitForPageDecrypts(
    messages: MessageData[],
    signal: AbortSignal | undefined
  ): Promise<boolean> {
    if (messages.length === 0) {
      return true;
    }
    if (stopped || signal?.aborted || runController?.signal.aborted) {
      return false;
    }
    let onAbort: (() => void) | null = null;
    // oxlint-disable-next-line promise/avoid-new -- resolves only from abort events, which have no async form
    const aborted = new Promise<false>((resolve) => {
      onAbort = () => resolve(false);
      runController?.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    // Awaiting the call rather than chaining it: some callers return void
    // instead of a promise, and `.then` on void is a TypeError. A wait that
    // throws is treated like one that timed out -- the page processes with
    // whatever resolved, and the rest stays pending -- because ending the
    // whole walk on a wait error would strand coverage behind one bad page.
    const ready = (async (): Promise<true> => {
      try {
        await awaitDecrypts(messages);
      } catch {
        // Settles as waited-out: see above.
      }
      return true;
    })();
    try {
      const outcome = await Promise.race([ready, aborted]);
      return outcome;
    } finally {
      if (onAbort) {
        runController?.signal.removeEventListener("abort", onAbort);
        signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  // Resolves false as soon as ANY of the walk's own stop signals trips, without
  // waiting for the raced work. Extracted because the yield below needs it for
  // the same reason the decrypt wait does: a hook that only resolves on a
  // release would otherwise make `stop()` hang until the transcript happened to
  // let go.
  //
  // A distinct sentinel rather than a boolean, because the raced work resolves
  // to whatever it resolves to and a hook that happens to settle with `true`
  // would otherwise read as an abort.
  const ABANDONED = Symbol("abandoned");
  async function abortedFirst(
    signal: AbortSignal | undefined,
    work: Promise<unknown>
  ): Promise<boolean> {
    let onAbort: (() => void) | null = null;
    // oxlint-disable-next-line promise/avoid-new -- resolves only from abort events, which have no async form
    const aborted = new Promise<typeof ABANDONED>((resolve) => {
      onAbort = () => {
        resolve(ABANDONED);
      };
      runController?.signal.addEventListener("abort", onAbort, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const outcome = await Promise.race([work, aborted]);
      return outcome === ABANDONED;
    } catch {
      // The hook itself failed. Treated as abandoned: the walk has no opinion
      // about why, and a pause the next run continues from is the safe reading.
      return true;
    } finally {
      if (onAbort) {
        runController?.signal.removeEventListener("abort", onAbort);
        signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  // Waits for the transcript to stop reading history before the walk asks for a
  // page. False means the walk must not request anything: the caller was
  // stopped, the run's signal tripped, or the wait itself was abandoned.
  //
  // The abort signals are re-checked after the wait rather than inside it,
  // because the hook resolves on an abort as well as on a release: a resolved
  // wait alone does not say whether the endpoint is free or the walk is finished.
  async function yieldToTranscriptReads(
    signal: AbortSignal | undefined
  ): Promise<boolean> {
    if (stopped || signal?.aborted || runController?.signal.aborted) {
      return false;
    }
    if (!beforePage) {
      return true;
    }
    // Called inside the try as well as awaited there, so a hook that throws
    // SYNCHRONOUSLY -- a conversation that changed under it, a store that is
    // gone -- is the same pause as one that rejects. A synchronous throw would
    // otherwise escape before the race was set up and take the whole run with it.
    let work: Promise<unknown>;
    try {
      work = Promise.resolve(beforePage());
    } catch {
      return false;
    }
    const abandoned = await abortedFirst(signal, work);
    if (abandoned) {
      return false;
    }
    return !(stopped || signal?.aborted || runController?.signal.aborted);
  }

  async function walk(
    signal: AbortSignal | undefined
  ): Promise<BackfillProgress> {
    setState("running");
    runController = new AbortController();
    let cursor: string | undefined;
    let chainVerified: boolean;
    try {
      const meta = await store.readMeta(conversationId);
      cursor = meta?.indexedThroughId ?? undefined;
      // No cursor means descending from the top, which verifies itself; a
      // cursor is only as trustworthy as the mark left with it (absent on
      // legacy rows, which heal by descending once).
      chainVerified = cursor === undefined || meta?.cursorVerified === true;
    } catch {
      // Unreadable meta means no resume point; walk from the newest indexed row.
      cursor = undefined;
      chainVerified = true;
    }
    // Rows already queued as unsearchable, read once per run. A page holding
    // only these needs no decrypt or commit -- the queue outlives the run and
    // the writer retries it -- but the cursor still advances past it.
    let durableSnapshot = new Set<string>();
    try {
      durableSnapshot = new Set(await store.readPending(conversationId));
    } catch {
      // Unreadable queue: pages fall back to decrypting and deciding per row.
    }
    // Rows this run queued but could not index yet. Together with the snapshot
    // above, the set of ids the run knows are covered without re-reading.
    const pendingThisRun = new Set<string>();
    if (cursor !== undefined) {
      // Trust-but-verify the resume hint. The walk only ever descends, so a
      // cursor pointing below uncovered history -- new arrivals above it, a
      // stale row from another era or store version -- would strand everything
      // above it forever while reporting steady progress. The hint is kept
      // only when the newest page is covered AND a previous verifying run
      // vouched for the chain; otherwise the run descends from the top,
      // re-covering old ground idempotently on the way down (the per-page
      // check below skips it for one fetch per page, no decrypts).
      try {
        if (!(await yieldToTranscriptReads(signal))) {
          return progress;
        }
        const top = await fetchPage();
        const topIds = top.messages.map((row) => row.id);
        if (topIds.length > 0) {
          const indexedTop = await store.hasIndexedMessages(
            conversationId,
            topIds
          );
          const topCovered = topIds.every(
            (id) =>
              indexedTop.has(id) ||
              durableSnapshot.has(id) ||
              pendingThisRun.has(id)
          );
          if (!topCovered || !chainVerified) {
            cursor = undefined;
          }
        }
      } catch {
        // A failed probe must not kill the run; fall back to the resume hint
        // and let the normal per-page checks do what they can.
      }
      // Whatever follows -- a kept hint from a vouched chain, or a fresh
      // descent from the top -- verifies its way down from here, so the cursor
      // this run persists is vouched for the next one.
      chainVerified = true;
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
      let abandoned = false;
      for (let attempt = 0; attempt <= MAX_THROTTLE_RETRIES; attempt += 1) {
        if (stopped || signal?.aborted) {
          abandoned = true;
          break;
        }
        // Asked for before the FIRST attempt and again after every backoff, not
        // once per page: a throttle wait is exactly when a user jump is most
        // likely to be mid-read, and re-checking is what stops the walk from
        // spending the first request of its next attempt inside someone's
        // anchored read.
        if (!(await yieldToTranscriptReads(signal))) {
          abandoned = true;
          break;
        }
        try {
          fetched = await fetchPage(cursor);
          break;
        } catch (error) {
          if (stopped || signal?.aborted) {
            abandoned = true;
            break;
          }
          if (isHistoryThrottled(error)) {
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
            abandoned = await sleepOrAbort(
              error.retryAfterSeconds * 1000,
              signal,
              runController?.signal
            );
            if (abandoned) {
              break;
            }
            continue;
          }
          if (
            (isHistoryUnauthorized(error) ||
              isHistoryServerError(error) ||
              isHistoryNetworkError(error)) &&
            attempt < MAX_TRANSIENT_RETRIES
          ) {
            // A flap, not a verdict: sessions expire and heal, servers deploy,
            // dev servers restart. Wait with a growing backoff and try the same
            // page again; the budget bounds the stall and a dead session still
            // fails the run. Anything the server understood and refused (400,
            // 403, 404) skips this branch and fails below: retrying it cannot
            // heal it.
            abandoned = await sleepOrAbort(
              Math.min(retryDelayMs * 2 ** attempt, retryDelayMs * 8),
              signal,
              runController?.signal
            );
            if (abandoned) {
              break;
            }
            continue;
          }
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
      }
      if (abandoned) {
        // Stopped mid-fetch: nothing committed for this page, so the cursor is
        // current; halt before fetching a page nobody will read. A stop is
        // silent by contract, never a failure.
        break;
      }
      if (!fetched) {
        setState("failed");
        report({ indexedCount: indexed, latestIndexedId, pageCount: pages });
        return progress;
      }

      const { messages, previousCursor } = fetched;
      let waitedOut = true;
      if (messages.length > 0) {
        // Skip pages the device already covered: no decrypts to wait for, no
        // commit to make. The cursor still advances past them, so a resumed or
        // reordered walk fast-forwards over old ground instead of re-paying
        // for it -- while still verifying every page, so a gap can never hide
        // behind a trusted cursor again.
        const pageIds = messages.map((row) => row.id);
        const indexedPage = await store.hasIndexedMessages(
          conversationId,
          pageIds
        );
        const uncovered = messages.filter(
          (row) =>
            !indexedPage.has(row.id) &&
            !durableSnapshot.has(row.id) &&
            !pendingThisRun.has(row.id)
        );
        if (uncovered.length === 0) {
          // Nothing to do: the cursor and counts advance through the shared
          // tail below, and the flush still runs so transcript-queued rows
          // commit on the walk's cadence rather than their own.
        } else {
          // Decrypt first: the writer can only index a row whose payload it can
          // read, and handing it undecrypted rows would just queue them as pending
          // and retry them against a transcript that will never hold them.
          // A stop lands here as an abandoned wait, not a skipped page: the
          // fetched rows still commit below, and the halt happens after them.
          waitedOut = await waitForPageDecrypts(uncovered, signal);
          writer.consider(uncovered);
        }
        const result = await writer.flush();
        indexed += messages.length;
        pending = result.stillPending.length;
        for (const id of result.stillPending) {
          pendingThisRun.add(id);
        }
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
      await persistCursor(oldestReachedId, false, chainVerified);

      if (!waitedOut || stopped || signal?.aborted) {
        // Stopped mid-page: the fetched rows committed above, so the cursor is
        // current; halt before fetching a page nobody will read.
        break;
      }
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
    await persistCursor(oldestReachedId, reachedStart, chainVerified);
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
      runController?.abort();
    },
  };
}
