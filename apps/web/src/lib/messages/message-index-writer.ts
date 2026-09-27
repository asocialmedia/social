// Write path for the local message search index. Everything that can be
// indexed is indexed the moment its payload is available on this device; nothing
// touches the server.
//
// Three properties this file exists to guarantee:
//
// - Bulk, never per-message. Writes are coalesced onto a timer, so a page of 100
//   arriving rows costs one transaction rather than 100.
// - Lossless. A row that cannot be indexed yet (still decrypting, decrypt error,
//   or its payload evicted from the decryptor LRU) is recorded as pending,
//   retried on every later batch, AND persisted so the queue survives the tab.
//   The failure mode this prevents is the worst one for search: a message that
//   exists and is silently unsearchable.
// - Idempotent. Re-indexing a row replaces its entry rather than appending, so a
//   retried batch, an overlapping page, or a second device can never duplicate a
//   posting. That is what makes the backfill safe to resume.

import { extractSearchableText } from "./message-search";
import type { SearchablePayload } from "./message-search";
import { buildSearchIndexEntry } from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";

// Mirrors the decryptor's public shape; injected so the writer is testable
// without WebCrypto or a DOM.
export type IndexablePayload = SearchablePayload;

export interface IndexableMessage {
  createdAt: Date | string;
  deletedAt?: Date | string | null;
  id: string;
  senderId: string;
}

export type PayloadLookup = (
  id: string
) => IndexablePayload | "error" | "pending" | undefined;

export interface MessageIndexWriterOptions {
  conversationId: string;
  // Called when a write is refused for lack of storage. Without this the
  // failure is silent and permanent-looking: rows stay pending forever and the
  // bar says "No matches yet" for a conversation that is simply full. The host
  // evicts and tells the user.
  onStorageFull?: () => void;
  // Notified when a payload's decryptor entry changes, so pending rows are
  // retried when their text finally arrives rather than only when the next
  // batch happens to include them. Injected so the writer is testable without a
  // decryptor.
  subscribeToPayloads?: (listener: () => void) => () => void;
  // Injected for tests; defaults are wired by the caller in the thread.
  getPayload: PayloadLookup;
  onCoverage?: (coverage: MessageIndexCoverage) => void;
  store: SearchIndexStore;
}

export interface MessageIndexCoverage {
  // Rows known to be indexed in this session (not the whole conversation; the
  // persisted count comes from the store when a backfill is running).
  indexedCount: number;
  // Ids that exist but are not searchable yet.
  pendingCount: number;
}

// Ceiling on how many ids are remembered as pending. A pathological case (every
// row failing to decrypt) would otherwise grow this without bound. Rows trimmed
// from the in-session retry set move to the durable set rather than being lost.
const MAX_TRACKED_PENDING = 5000;
// Ceiling on the PERSISTED queue, for the same reason: a conversation where
// nothing decrypts must not grow an unbounded record. Rows past it are genuinely
// unindexed -- a real loss of coverage, reported through the bar's pending count
// rather than hidden.
const MAX_DURABLE_PENDING = 5000;

// How long coalesced writes wait for the rest of their batch before committing.
// Short enough that a decrypted row becomes searchable almost at once, long
// enough that a burst of completions is ONE transaction instead of one each --
// which is the knob keeping the IndexedDB write lock free for reads; see
// `schedule`.
const FLUSH_WINDOW_MS = 120;
// Upper bound on consecutive flush passes. A flush repeats only while new rows
// arrived mid-drain; without a bound, a caller feeding rows continuously could
// hold `flush` indefinitely. Rows beyond the bound stay queued and durably
// persisted, so they are retried rather than lost.
const MAX_DRAIN_PASSES = 8;

// What one flush actually achieved. `flush` used to return nothing, which left
// the backfill unable to tell a committed page from one whose rows were all
// still queued, so it advanced its cursor either way.
export interface MessageIndexFlushResult {
  // Rows that are now in the index.
  committed: string[];
  // Rows that exist but have nothing searchable (empty body, captionless media),
  // so they are settled and removed rather than retried forever.
  settledEmpty: string[];
  // Rows still not searchable: payload not decrypted, or the write was refused.
  stillPending: string[];
  // True when either the index write or the durable pending write was refused.
  // The backfill must not advance its cursor past a page in this state, because
  // the rows in it are not recoverable from anywhere else.
  failed: boolean;
}

export interface MessageIndexWriter {
  // Rows whose payload may have become available, or changed (an edit).
  consider: (messages: readonly IndexableMessage[]) => void;
  // Persist any coalesced writes immediately. Callers use this before measuring
  // coverage or when tearing the conversation down.
  flush: () => Promise<MessageIndexFlushResult>;
  // Rows persisted as not-yet-searchable from an earlier session. The caller
  // re-fetches and re-considers them; the writer only owns the bookkeeping.
  durablePending: () => Promise<string[]>;
  // Deleted, globally, or hidden for this user: drop them from the index.
  remove: (messageIds: readonly string[]) => void;
  // Hold coalesced writes for the caller that is about to flush itself, so a
  // long walk does not compete with parallel transcript commits. See `deferring`.
  setDeferring: (defer: boolean) => void;
  coverage: () => MessageIndexCoverage;
}

// The indexed text, taken from the SAME extractor the ranked in-memory path uses.
// When the two disagreed (the store stored captions only, omitting the kind
// label), a captionless image matched in the transcript and vanished after a
// reload. One extractor removes that class of drift.
function payloadText(payload: IndexablePayload): string {
  return extractSearchableText(payload).text;
}

// Recognises the browser's out-of-space signals. They differ by engine and by
// whether the failure surfaced as a DOMException, a legacy error code, or a
// wrapped one, so all three are checked rather than trusting any single shape.
export function isStorageExhausted(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; name?: unknown };
  if (candidate.name === "QuotaExceededError") {
    return true;
  }
  return (
    candidate.code === 22 ||
    candidate.code === 1014 ||
    candidate.name === "NS_ERROR_DOM_QUOTA_REACHED"
  );
}

// Identifies an entry's content so a re-index can be skipped without decrypting
// twice. Derived from the built entry, not the payload, so it is stable for
// identical text regardless of how it arrived.
function entrySignature(entry: SearchIndexEntry): string {
  return JSON.stringify([entry.createdAt, entry.senderId, entry.tokens]);
}

export function createMessageIndexWriter(
  options: MessageIndexWriterOptions
): MessageIndexWriter {
  const {
    conversationId,
    getPayload,
    onCoverage,
    onStorageFull,
    store,
    subscribeToPayloads,
  } = options;
  // Ids whose index entry we believe is current, with the signature of the text
  // it was built from. A mismatch on the next flush is what triggers a rewrite
  // for an edited message.
  const written = new Map<string, string>();
  const pending = new Map<string, IndexableMessage>();
  const removed = new Set<string>();
  // Handle for the pending coalescing window, so a timer that has not fired yet
  // is still "already scheduled" and cannot be stacked by a later `consider`.
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Batches are chained on this promise so two can never overlap, no matter who
  // scheduled them. Overlapping batches iterated the same `pending` map
  // concurrently, each seeing a partial view and both committing over each other
  // -- which is how a walk reported thousands of commits while the row count
  // never moved.
  let batchChain: Promise<void> = Promise.resolve();
  // Bumped on every `consider`. `flush` loops until a batch completes without
  // any new row arriving mid-batch, so work landing during the drain commits in
  // the same flush rather than being stranded for a later window.
  let batchEpoch = 0;
  // While a backfill walk is running, coalesced writes wait for the walk's own
  // flush instead of firing on their own.
  //
  // Every commit takes the IndexedDB write lock, contending with every other
  // commit and every search read. The walk commits once per page; the
  // transcript's decrypt completions called `consider` continuously alongside
  // it, so a walk wanting 400 page writes also paid for a steady stream of
  // transcript writes that starved reads. Deferring makes the walk the only
  // committer, so the cost is one commit per page. Rows are not lost: they sit
  // in `pending` and the walk's `flush()` writes them with its batch.
  let deferring = false;

  function notifyCoverage(): void {
    onCoverage?.({
      indexedCount: written.size,
      // The durable count, not the in-memory one: a row dropped from the retry
      // set is still a gap in coverage, and the bar has to keep saying so.
      pendingCount: durable.size,
    });
  }

  // Ids known to be unsearchable, mirrored into the store so a reload does not
  // forget them. The writer is the only writer, so a whole-set write is safe
  // where an incremental one would only add a boundary to get wrong.
  const durable = new Set<string>();
  // Durable size at the last coverage notification, so a flush that changed
  // nothing stays silent instead of re-rendering every subscriber into another
  // empty flush.
  let lastNotifiedDurable = 0;
  // Outcome of the most recent batch, so flush reports what actually ran rather
  // than running a second pass to obtain a value -- a second pass would retry a
  // refused write inside the same flush, which is how a test asserting "the
  // store refused this" observed a successful write instead.
  let lastResult: MessageIndexFlushResult = {
    committed: [],
    failed: false,
    settledEmpty: [],
    stillPending: [],
  };

  async function persistPending(): Promise<boolean> {
    const ids = [...durable].slice(0, MAX_DURABLE_PENDING);
    try {
      await store.writePending(conversationId, ids);
      return true;
    } catch {
      // The queue could not be persisted, so these rows are recoverable from
      // nowhere: the backfill must not move its cursor past them.
      return false;
    }
  }

  async function writeBatch(): Promise<MessageIndexFlushResult> {
    const committed: string[] = [];
    const settledEmpty: string[] = [];
    if (pending.size === 0) {
      // Still flush an emptied durable queue, so a conversation that has caught up
      // does not leave a stale record claiming otherwise.
      await persistPending();
      lastResult = {
        committed,
        failed: false,
        settledEmpty,
        stillPending: [...durable],
      };
      return lastResult;
    }
    const batch = new Map<string, SearchIndexEntry>();
    // Collected and applied as ONE transaction after the pass. Awaiting a
    // removal per row inside this loop would mean one IndexedDB transaction per
    // deleted message: the write amplification this module exists to avoid.
    const toRemove: string[] = [];

    for (const [id, message] of pending) {
      if (removed.has(id)) {
        pending.delete(id);
        continue;
      }
      if (message.deletedAt) {
        pending.delete(id);
        durable.delete(id);
        toRemove.push(id);
        continue;
      }
      const payload = getPayload(id);
      if (
        payload === undefined ||
        payload === "pending" ||
        payload === "error"
      ) {
        // Still queued. Undefined means the decryptor evicted the payload (its
        // LRU) and "error" means key healing has not run yet; both are retried
        // rather than dropped, and both are persisted so the queue outlives
        // this session.
        durable.add(id);
        continue;
      }
      const built = buildSearchIndexEntry({
        createdAt: new Date(message.createdAt).getTime(),
        senderId: message.senderId,
        text: payloadText(payload),
      });
      if (!built) {
        // Nothing searchable (empty body, whitespace, captionless media). Not
        // queued: re-checking every batch would be busy work. Any previous entry
        // goes, so an edit to empty cannot leave a stale hit behind.
        pending.delete(id);
        durable.delete(id);
        settledEmpty.push(id);
        toRemove.push(id);
        continue;
      }
      const signature = entrySignature(built);
      if (written.get(id) === signature) {
        pending.delete(id);
        durable.delete(id);
        continue;
      }
      batch.set(id, built);
    }

    if (toRemove.length > 0) {
      await removeEntries(toRemove);
    }

    if (batch.size > 0) {
      try {
        await store.putEntries(conversationId, batch);
        for (const [id, entry] of batch) {
          written.set(id, entrySignature(entry));
          pending.delete(id);
        }
        for (const id of batch.keys()) {
          committed.push(id);
          durable.delete(id);
        }
      } catch (error) {
        // Storage refused. Leave the whole batch queued so a later attempt
        // retries it rather than losing rows, record it durably so it survives
        // the tab, and surface it once: a full disk otherwise looks exactly
        // like a conversation with no matches, and the user cannot tell the
        // difference.
        for (const id of batch.keys()) {
          durable.add(id);
        }
        if (isStorageExhausted(error)) {
          onStorageFull?.();
        }
      }
    }

    // Bound the tracked set so a conversation where nothing can decrypt cannot
    // grow this map forever. The oldest are the ones given up on.
    if (pending.size > MAX_TRACKED_PENDING) {
      const excess = pending.size - MAX_TRACKED_PENDING;
      let dropped = 0;
      for (const id of pending.keys()) {
        if (dropped >= excess) {
          break;
        }
        // Dropped from the in-session RETRY set only; the id stays durable, so
        // it is recovered next session rather than silently lost.
        pending.delete(id);
        durable.add(id);
        dropped += 1;
      }
    }

    // Persisted after the trim, so what survives to disk is the durable set
    // rather than the in-memory one.
    const persisted = await persistPending();
    // Notify only on change. An unconditional notify re-renders every
    // subscriber on every flush, and one subscriber -- the transcript's writer
    // feed -- re-considers on every notification, scheduling another flush: a
    // self-sustaining loop of empty commits (~8/sec measured) that cancels any
    // search read slower than its cadence before it can land.
    if (
      committed.length > 0 ||
      settledEmpty.length > 0 ||
      toRemove.length > 0 ||
      durable.size !== lastNotifiedDurable
    ) {
      lastNotifiedDurable = durable.size;
      notifyCoverage();
    }
    lastResult = {
      committed,
      failed: !persisted,
      settledEmpty,
      stillPending: [...durable],
    };
    return lastResult;
  }

  async function removeEntries(ids: string[]): Promise<void> {
    for (const id of ids) {
      written.delete(id);
      pending.delete(id);
      durable.delete(id);
      removed.add(id);
    }
    try {
      await store.removeEntries(conversationId, ids);
    } catch (error) {
      // Same posture as the write: a stale entry that outlives its row is better
      // than a rejected delete, and the row is gone from the transcript so it
      // cannot be clicked. Re-indexing the conversation repairs it.
      if (isStorageExhausted(error)) {
        onStorageFull?.();
      }
    }
  }

  function schedule(): void {
    if (deferring) {
      return;
    }
    if (timer !== null) {
      return;
    }
    // A REAL timer, not a microtask, and this is the difference between search
    // working and search appearing dead.
    //
    // A microtask runs before the browser can complete an IndexedDB transaction,
    // so it only merged `consider` calls already synchronous with each other.
    // Decrypt completions arrive on their own ticks, so a 500-message page
    // produced a steady drip of back-to-back write transactions -- measured at
    // roughly 200 commits/second on a 12k-row index -- holding the write lock
    // essentially all the time. Every search read queued behind them: coverage
    // stayed at zero and a query never resolved, which is what presented as "no
    // matches" and as a tab that got slower the longer it stayed open.
    //
    // A timer window coalesces a whole tick's worth of completions into one
    // commit, so the lock is idle between batches and reads get through. The
    // cost is a bounded delay before a fresh row is searchable, which the
    // coverage bar already reports honestly.
    timer = setTimeout(() => {
      timer = null;
      if (deferring) {
        // A walk started inside this window; it flushes what is queued with its
        // own page, so committing here too would put two transactions back in
        // contention.
        return;
      }
      void enqueueBatch();
    }, FLUSH_WINDOW_MS);
  }

  // Chains one batch behind whatever is already queued. The returned promise
  // resolves when this batch finishes; a rejection inside one batch must not
  // break the chain for later ones, so failures are swallowed here (the batch
  // itself already records them in `lastResult`).
  function enqueueBatch(): Promise<void> {
    const previous = batchChain;
    let release!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- a mutex handoff has no async/await form
    batchChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (async () => {
      await previous;
      try {
        await writeBatch();
      } finally {
        release();
      }
    })();
    return run;
  }

  // Pending rows are retried when their payload finally lands, not only when the
  // next batch happens to include them. Without this a row that missed its window
  // waited for unrelated activity, and a quiet conversation never caught up.
  subscribeToPayloads?.(() => {
    if (pending.size > 0) {
      schedule();
    }
  });

  // Loaded once, so a row that was unsearchable last session is retried as soon
  // as the caller re-fetches and re-considers it.
  void (async () => {
    try {
      for (const id of await store.readPending(conversationId)) {
        durable.add(id);
      }
    } catch {
      // Unreadable queue: the conversation behaves as fully indexed, which the
      // walk repairs by re-fetching from its cursor.
    }
  })();

  return {
    consider(messages) {
      for (const message of messages) {
        removed.delete(message.id);
        const current = written.get(message.id);
        if (current !== undefined) {
          // Already indexed. An edit rewrites the row object, so comparing the
          // object identity is a cheap way to spot a change without decrypting:
          // the decryptor entry is only consulted on an actual mismatch.
          const known = pending.get(message.id);
          if (known === message) {
            continue;
          }
        }
        pending.set(message.id, message);
        batchEpoch += 1;
        schedule();
      }
    },

    coverage() {
      return { indexedCount: written.size, pendingCount: pending.size };
    },

    durablePending() {
      return store.readPending(conversationId);
    },

    async flush() {
      // A window armed but not yet fired still owns pending rows, and `flush` is
      // the caller's guarantee they are committed. Disarming and draining inline
      // keeps that guarantee without waiting out the window; every batch goes
      // through the same chain, so this can never overlap one the timer started.
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Repeat only while new rows arrived mid-drain. A refused write with no new
      // arrivals stops after one pass, so an honest "the store refused this" is
      // never retried into a silent success inside the same flush.
      // oxlint-disable no-await-in-loop -- passes must be sequential; awaiting them together would overlap batches, which is the bug this chain exists to prevent
      for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
        const seen = batchEpoch;
        await enqueueBatch();
        if (batchEpoch === seen) {
          break;
        }
      }
      // oxlint-enable no-await-in-loop
      return lastResult;
    },

    remove(messageIds) {
      if (messageIds.length === 0) {
        return;
      }
      for (const id of messageIds) {
        pending.delete(id);
      }
      void removeEntries([...messageIds]);
      notifyCoverage();
    },

    setDeferring(next) {
      if (deferring === next) {
        return;
      }
      deferring = next;
      // Leaving deferral must not strand rows the walk did not write: the walk
      // calls this after its last page, so anything still queued gets one final
      // commit rather than waiting for unrelated activity.
      if (!deferring) {
        schedule();
      }
    },
  };
}
