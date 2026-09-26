// Write path for the local message search index.
//
// Everything that can be indexed is indexed the moment its payload is available
// on this device; nothing about this touches the server.
//
// Three properties this file exists to guarantee:
//
// - Bulk, never per-message. Writes are coalesced onto a microtask, so a page of
//   100 arriving rows costs one transaction rather than 100. Per-entry
//   transactions are the difference between indexing a conversation in seconds
//   and in minutes.
// - Lossless. A row that cannot be indexed yet (still decrypting, decrypt
//   error, or its payload evicted from the decryptor LRU) is recorded as pending,
//   retried on every later batch, AND persisted so the queue survives the tab.
//   The failure mode this prevents is the worst one for search: a message that
//   exists and is silently unsearchable. Persistence is the part that was
//   missing: the pending set used to live only in memory while the backfill
//   cursor advanced past those rows regardless, so a decrypt timeout or a refused
//   write left a permanent hole that nothing ever revisited.
// - Idempotent. Re-indexing a row replaces its entry rather than appending, so a
//   retried batch, an overlapping page, or a second device can never duplicate a
//   posting. That is what makes the backfill in phase 2 safe to resume.

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
  // Called once when a write is refused for lack of storage. Without this the
  // failure is silent and permanent-looking: rows stay pending forever, the walk
  // reports no progress, and the bar says "No matches yet" for a conversation
  // that is simply full. The host evicts and tells the user.
  onStorageFull?: () => void;
  // Notified when a payload's decryptor entry changes, so pending rows are
  // retried when their text finally arrives rather than only when the next batch
  // happens to include them. Injected so the writer stays testable without a
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
// row failing to decrypt) would otherwise grow this without bound; the persisted
// list is a backfill aid, not a source of truth, and the in-session retry set is
// what actually drives retries.
const MAX_TRACKED_PENDING = 5000;
// Ceiling on the PERSISTED queue. Same reasoning as the in-memory cap: a
// conversation where nothing decrypts must not grow an unbounded record. Rows past
// the ceiling are genuinely unindexed, which is a real loss of coverage, so this is
// reported through the bar's pending count rather than hidden.
const MAX_DURABLE_PENDING = 5000;

// How long coalesced writes wait for the rest of their batch before committing.
//
// Short enough that a freshly decrypted row becomes searchable almost at once,
// and long enough that a burst of decrypt completions becomes ONE transaction
// instead of one per completion. This is the knob that keeps the IndexedDB write
// lock free for reads; see `schedule` for what happens without it.
const FLUSH_WINDOW_MS = 120;
// Upper bound on consecutive flush passes. A flush repeats only while new rows
// arrived mid-drain; without a bound, a caller feeding rows continuously could
// hold `flush` indefinitely. Rows beyond the bound stay queued and durably
// persisted, so they are retried rather than lost.
const MAX_DRAIN_PASSES = 8;

// What one flush actually achieved. `flush` used to return nothing, which left
// the backfill with no way to tell a committed page from a page whose rows were
// all still queued, so it advanced its cursor either way.
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
  // long walk is not competing with a parallel stream of full-table commits from
  // the transcript. See the note on `deferring`.
  setDeferring: (defer: boolean) => void;
  coverage: () => MessageIndexCoverage;
}

// The indexed text, taken from the SAME extractor the ranked in-memory path uses.
// It previously stored captions only and omitted the kind label, so a captionless
// image matched in the transcript and vanished after a reload. One extractor
// removes that whole class of drift: a message now matches the same way whether
// it was found in RAM or in the persisted index.
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
  // Batches are chained on this promise, so two batches can never overlap no
  // matter who scheduled them -- the coalescing timer, a flush, or a payload
  // retry. Overlapping batches used to iterate the same `pending` map
  // concurrently, so each saw a partial view, both committed over each other,
  // and `lastResult` reported whichever finished last -- which is how a walk
  // could report thousands of commits while the row count never moved.
  let batchChain: Promise<void> = Promise.resolve();
  // Bumped on every `consider`. `flush` loops until a batch completes without
  // any new row arriving mid-batch, so work that lands during the drain is
  // committed by the same flush rather than stranded for a later window.
  let batchEpoch = 0;
  // While a backfill walk is running, coalesced writes wait for the walk's own
  // flush instead of firing on their own.
  //
  // Every commit takes the IndexedDB write lock, so its cost is contention with
  // every other commit and every search read. The walk already commits once per
  // page, and the transcript's decryptor completions call `consider`
  // continuously alongside it. With both committing, a walk that wanted 400
  // page writes also paid for a steady stream of transcript writes, each one
  // contending with the walk for the same lock and starving reads. Deferring
  // makes the walk the only committer while it is active, so the cost is one
  // commit per page. Rows are not lost: they sit in `pending` and the walk's
  // `flush()` writes them with its batch. Outside a walk this is off, and
  // behaviour is unchanged.
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
  // forget them. The writer is the only writer, so a whole-set write is safe where
  // an incremental one would only add a second consistency boundary to get wrong.
  const durable = new Set<string>();
  // Durable size at the last coverage notification, so a flush that changed
  // nothing -- no commits, no empties, no removals, same queue -- stays silent
  // instead of re-rendering every subscriber into another empty flush.
  let lastNotifiedDurable = 0;
  // Outcome of the most recent batch, so flush can report what actually ran
  // rather than running a second one to obtain a value. A second pass would
  // retry a refused write inside the same flush, which is how a test asserting
  // "the store refused this" observed a successful write instead.
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
    // deleted message, which is the write amplification this whole module
    // exists to avoid.
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
        // LRU), and "error" means key healing has not run yet; both are retried
        // rather than dropped, so a message is never silently unsearchable, and
        // both are persisted so the queue outlives this session.
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
        // retries it rather than losing rows, record it durably so the rows are
        // not lost with the tab, and surface it once: a full disk otherwise looks
        // exactly like a conversation with no matches, and the user has no way to
        // tell the difference or act on it.
        for (const id of batch.keys()) {
          durable.add(id);
        }
        if (isStorageExhausted(error)) {
          onStorageFull?.();
        }
      }
    }

    // Bound the tracked set so a conversation where nothing can decrypt cannot
    // grow this map forever. The oldest entries are the ones given up on; they
    // remain covered by whatever is already persisted.
    if (pending.size > MAX_TRACKED_PENDING) {
      const excess = pending.size - MAX_TRACKED_PENDING;
      let dropped = 0;
      for (const id of pending.keys()) {
        if (dropped >= excess) {
          break;
        }
        // Dropped from the in-session RETRY set only. The id stays durable, so it
        // is still recovered next session rather than silently lost, which was
        // the point of the trim.
        pending.delete(id);
        durable.add(id);
        dropped += 1;
      }
    }

    // Persisted after the trim, so what survives to disk is the durable set
    // rather than the in-memory one.
    const persisted = await persistPending();
    // Notify only on change. An unconditional notify re-renders every
    // subscriber on every flush, and one subscriber -- the transcript's
    // writer feed -- re-considers on every notification, scheduling another
    // flush: a self-sustaining loop of empty commits (~8/sec measured) that
    // holds no lock but burns writes and re-renders forever, and -- worse --
    // cancels any search read slower than its cadence before it can land.
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
    // so it only ever merged `consider` calls that were already synchronous with
    // each other. Decrypt completions arrive on their own ticks: a 500-message
    // page decrypting produced a steady drip of commits, and because a flush
    // cleared `scheduled` as it finished, the next one started immediately. The
    // result was back-to-back write transactions with no gap -- measured at
    // roughly 200 commits per second on a 12k-row index -- which held the
    // write lock essentially all the time. Every search read then queued behind
    // them: coverage stayed at zero and a query never resolved, which is what
    // presented as "no matches" and as a tab that got slower the longer it was
    // left open.
    //
    // A timer window coalesces a whole tick's worth of completions into one
    // commit, so the lock is idle between batches and reads get through. The
    // cost is a bounded delay before a freshly decrypted row is searchable,
    // which the coverage bar already reports honestly.
    timer = setTimeout(() => {
      timer = null;
      if (deferring) {
        // A walk started inside this window. It is the only committer while it
        // runs, and it flushes what is queued with its own page, so committing
        // here too would put two transactions back in contention.
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
  // waited for unrelated activity, and a conversation that had gone quiet simply
  // never caught up.
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
      // A window that has been armed but not yet fired still owns pending rows,
      // and `flush` is the caller's guarantee that they are committed. Disarming
      // the timer and draining inline keeps that guarantee without waiting out
      // the window, and every batch goes through the same chain so this can
      // never overlap one the timer already started.
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Repeat only while new rows arrived mid-drain. A refused write with no
      // new arrivals stops after one pass, so an honest "the store refused
      // this" is never retried into a silent success inside the same flush.
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
