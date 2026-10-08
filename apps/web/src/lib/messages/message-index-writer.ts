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

import type { MessagePayload } from "./crypto";
import { extractSearchableText } from "./message-search";
import { extractSharedRefs } from "./message-shared-refs";
import type { SharedRefs } from "./message-shared-refs";
import { buildSearchIndexEntry } from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";
import type { SharedRefsWriteRow } from "./shared-refs-format";

// Mirrors the decryptor's public shape; injected so the writer is testable
// without WebCrypto or a DOM.
// The writer's payload lookup returns the FULL decrypted payload, not the loose
// view `extractSearchableText` accepts.
//
// That is not a nicety: the details panel's tabs are derived from the attachment
// and post references, which `SearchablePayload` deliberately does not carry. A
// looser lookup type would mean either casting at the extraction site or leaving
// the panel blind to every post and image, and the cast is the version of this
// that fails silently. `SearchablePayload` still exists, as the narrower contract
// the text extractor genuinely needs.
export type IndexablePayload = MessagePayload;

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
  // Recent rows whose current signatures are cached by this writer.
  indexedCount: number;
  // Ids that exist but are not searchable yet.
  pendingCount: number;
}

// Ceiling on how many ids are remembered in-session. A pathological case (every
// row failing to decrypt) would otherwise grow this without bound; the durable
// queue retains the full backlog while the tab retries only recent rows.
const MAX_TRACKED_PENDING = 5000;
// Signatures only avoid repeat work for messages the writer has recently seen.
// Keeping one for every row in a long backfill grows the tab's heap with history.
const MAX_WRITTEN_SIGNATURES = 1024;

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
  durablePending: (messageIds: readonly string[]) => Promise<string[]>;
  // Flushes any queued work and releases the decryptor subscription and timer.
  dispose: () => Promise<MessageIndexFlushResult>;
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

// Identifies a row's TEXT so a re-index can be skipped without decrypting twice.
// Derived from the built entry, not the payload, so it is stable for identical
// content regardless of how it arrived.
function textSignature(entry: SearchIndexEntry | null): string | null {
  return entry
    ? JSON.stringify([entry.createdAt, entry.senderId, entry.tokens])
    : null;
}

// The same for the REFS, and that is load-bearing rather than thoroughness.
// Swapping one link for another leaves every token identical, so a text-only
// signature calls the row current and the panel goes on showing a URL the message
// no longer contains. Media is the same story: an image swapped for a GIF changes
// no word.
function refsSignature(refs: SharedRefs | null): string | null {
  return refs
    ? JSON.stringify([
        refs.postIds,
        refs.links,
        refs.media.map((image) => [image.url, image.kind, image.imageIndex]),
      ])
    : null;
}

// What this writer believes is stored for a message, per index. The two halves are
// tracked SEPARATELY and skipped only when both match, which is the fix for a real
// bug: a single combined signature meant a message whose text row committed while
// its refs write failed looked "current" on the next pass, so the retry that was
// supposed to close the hole skipped it forever.
interface WrittenState {
  refs: string | null;
  text: string | null;
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
  // Ids whose stored rows we believe are current, with the signature each half was
  // built from. A mismatch on the next flush is what triggers a rewrite for an
  // edited message -- and because the halves are compared separately, a half that
  // failed to write is retried instead of being mistaken for current.
  const written = new Map<string, WrittenState>();
  const pending = new Map<string, IndexableMessage>();
  const unpersistedPending = new Set<string>();
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
  let disposed = false;
  let unsubscribeFromPayloads: (() => void) | null = null;

  function getWrittenState(id: string): WrittenState | undefined {
    const state = written.get(id);
    if (state) {
      written.delete(id);
      written.set(id, state);
    }
    return state;
  }

  function rememberWrittenState(id: string, state: WrittenState): void {
    written.delete(id);
    written.set(id, state);
    if (written.size > MAX_WRITTEN_SIGNATURES) {
      const oldestId = written.keys().next().value;
      if (oldestId !== undefined) {
        written.delete(oldestId);
      }
    }
  }

  function reportStorageFull(): void {
    if (!disposed) {
      onStorageFull?.();
    }
  }

  function notifyCoverage(): void {
    if (disposed) {
      return;
    }
    onCoverage?.({
      indexedCount: written.size,
      pendingCount: totalPendingCount(),
    });
  }

  function totalPendingCount(): number {
    return pendingCount + unpersistedPending.size;
  }

  let pendingCount = 0;
  let lastNotifiedPending = 0;
  let pendingCountMutated = false;
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

  async function updatePending(
    add: ReadonlySet<string>,
    remove: ReadonlySet<string>
  ): Promise<boolean> {
    try {
      pendingCount = await store.updatePending(conversationId, {
        add: [...add],
        remove: [...remove],
      });
      pendingCountMutated = true;
      for (const id of add) {
        unpersistedPending.delete(id);
      }
      for (const id of remove) {
        unpersistedPending.delete(id);
      }
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
    const pendingToAdd = new Set<string>();
    const pendingToRemove = new Set<string>();
    if (pending.size === 0) {
      let failed = false;
      try {
        pendingCount = await store.countPending(conversationId);
      } catch {
        failed = true;
      }
      lastResult = {
        committed,
        failed,
        settledEmpty,
        stillPending: [],
      };
      return lastResult;
    }
    const batch = new Map<string, SearchIndexEntry>();
    const expectedById = new Map<string, WrittenState>();
    // The two ref-side collections, split because they mean different things:
    // `refsBatch` is what to persist, and `textless` remembers the messages that
    // have shareable content but no searchable text — a captionless GIF, or a
    // bare image — which the text index cannot hold a row for and which would
    // otherwise be dropped from both.
    const refsBatch = new Map<string, SharedRefsWriteRow>();
    const textless = new Map<string, SharedRefs>();
    // Messages that HAD refs and now have none, so their stored rows can be
    // dropped. Tracked as an explicit list rather than left to the write path's
    // own "replace" step, because a message whose refs went away to zero is not in
    // `refsBatch` at all — and without this, an edit that strips the last link
    // leaves the old row in the store forever, with nothing left pointing at it.
    //
    // Keyed off what is actually stored, so this stays empty for the text-only
    // majority: sending every plain text message through a delete would double the
    // write traffic of every batch for no effect.
    const refsRemoved: string[] = [];
    // Collected and applied as ONE transaction after the pass. Awaiting a
    // removal per row inside this loop would mean one IndexedDB transaction per
    // deleted message: the write amplification this module exists to avoid.
    const toRemove: string[] = [];

    for (const [id, message] of pending) {
      if (message.deletedAt) {
        pending.delete(id);
        pendingToRemove.add(id);
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
        pendingToAdd.add(id);
        continue;
      }
      const built = buildSearchIndexEntry({
        createdAt: new Date(message.createdAt).getTime(),
        senderId: message.senderId,
        text: payloadText(payload),
      });
      // The same payload, read for what the details panel's tabs list. Derived
      // here rather than in a second pass so the text row and the refs row can
      // never come from different reads of a message that is being edited.
      const refs = extractSharedRefs(payload);
      if (!built && !refs) {
        // Nothing searchable and nothing shareable (an empty body, or a
        // captionless text message). Not queued: re-checking every batch would
        // be busy work. Any previous entry goes, so an edit to empty cannot leave
        // a stale hit behind.
        pending.delete(id);
        pendingToRemove.add(id);
        settledEmpty.push(id);
        toRemove.push(id);
        continue;
      }
      // Skipped only when BOTH halves already match what is stored, so the
      // transcript re-considering on every decrypt tick costs nothing while a
      // failed half is retried.
      const nextText = textSignature(built);
      const nextRefs = refsSignature(refs);
      expectedById.set(id, { refs: nextRefs, text: nextText });
      const state = getWrittenState(id);
      if (state && state.text === nextText && state.refs === nextRefs) {
        pending.delete(id);
        pendingToRemove.add(id);
        continue;
      }
      if (built && state?.text !== nextText) {
        batch.set(id, built);
      } else if (!built && refs && state?.refs !== nextRefs) {
        // Refs with no searchable text. The text index cannot hold a row with no
        // tokens, but the refs can, and this is exactly the message that would
        // otherwise be dropped from both.
        textless.set(id, refs);
      }
      if (refs && state?.refs !== nextRefs) {
        refsBatch.set(id, {
          createdAt: new Date(message.createdAt).getTime(),
          messageId: id,
          refs,
          senderId: message.senderId,
        });
      } else if (!refs && state?.refs !== null && state?.refs !== undefined) {
        // Refs went to zero on an edit: schedule the old rows for deletion. Keyed
        // off what was stored rather than off a side set, so the two cannot
        // disagree about whether a message has refs.
        refsRemoved.push(id);
      }
    }

    if (toRemove.length > 0) {
      await removeEntries(toRemove);
    }

    if (batch.size > 0) {
      try {
        await store.putEntries(conversationId, batch);
        for (const [id, entry] of batch) {
          // Only the TEXT half is settled by this transaction; the refs half is
          // left as it was, so a failed refs write below still reads as
          // out-of-date on the next pass.
          rememberWrittenState(id, {
            refs: getWrittenState(id)?.refs ?? null,
            text: textSignature(entry),
          });
        }
        for (const id of batch.keys()) {
          committed.push(id);
        }
      } catch (error) {
        // Storage refused. Leave the whole batch queued so a later attempt
        // retries it rather than losing rows, record it durably so it survives
        // the tab, and surface it once: a full disk otherwise looks exactly
        // like a conversation with no matches, and the user cannot tell the
        // difference.
        for (const id of batch.keys()) {
          pendingToAdd.add(id);
        }
        if (isStorageExhausted(error)) {
          reportStorageFull();
        }
      }
    }

    // Refs, in their OWN transaction and their OWN failure domain. A ref that
    // cannot be written leaves the tab showing the decrypted window instead of
    // the stored list; the reverse is not true, and a refs bug must not be able to
    // take search down with it.
    if (refsBatch.size > 0 || textless.size > 0) {
      const onlyRefs = new Map<string, SharedRefsWriteRow>();
      for (const [id, row] of refsBatch) {
        onlyRefs.set(id, row);
      }
      try {
        await store.putSharedRefs(conversationId, onlyRefs);
        for (const [id, row] of refsBatch) {
          rememberWrittenState(id, {
            refs: refsSignature(row.refs),
            text: getWrittenState(id)?.text ?? null,
          });
          // Only a message that has never been written is "committed" from the
          // refs side; a message that also had text was already counted above, and
          // counting it twice would make the walk's coverage counts disagree with
          // the store.
          if (!batch.has(id)) {
            committed.push(id);
          }
        }
        textless.clear();
      } catch (error) {
        // Left queued and durable, so the next batch retries: an unwritten ref is
        // a hole in the panel's list, and the hole closes on the next write rather
        // than needing a re-walk.
        for (const id of refsBatch.keys()) {
          pendingToAdd.add(id);
        }
        if (isStorageExhausted(error)) {
          reportStorageFull();
        }
      }
    }

    if (refsRemoved.length > 0) {
      // Deliberately outside the `refsBatch` try block: this is a delete, so a
      // failure leaves rows the user can still see rather than rows they cannot,
      // and re-indexing the message repairs it on the next pass.
      try {
        await store.removeSharedRefs(conversationId, refsRemoved);
        for (const id of refsRemoved) {
          const state = getWrittenState(id);
          if (state) {
            rememberWrittenState(id, { ...state, refs: null });
          }
        }
      } catch {
        // Nothing to surface: the text rows are already current, and the stale
        // ref row is invisible to the reader until the next re-index of it.
      }
    }

    // Bound the in-session retry set so a conversation where nothing can decrypt cannot
    // grow this map forever. The oldest are the ones given up on.
    if (pending.size > MAX_TRACKED_PENDING) {
      const excess = pending.size - MAX_TRACKED_PENDING;
      let dropped = 0;
      for (const id of pending.keys()) {
        if (dropped >= excess) {
          break;
        }
        // The durable queue was updated before this bounded map gave up on it.
        pending.delete(id);
        dropped += 1;
      }
    }

    // A message leaves the retry queue only when every derived index half has
    // committed. A ref write that fails after text succeeds stays pending and is
    // retried directly on the next payload notification, without rewriting text.
    for (const [id, expected] of expectedById) {
      const state = getWrittenState(id);
      if (state?.text === expected.text && state.refs === expected.refs) {
        pending.delete(id);
        pendingToAdd.delete(id);
        pendingToRemove.add(id);
      } else {
        pendingToRemove.delete(id);
        pendingToAdd.add(id);
      }
    }

    const persisted = await updatePending(pendingToAdd, pendingToRemove);
    // Notify only on change. An unconditional notify re-renders every
    // subscriber on every flush, and one subscriber -- the transcript's writer
    // feed -- re-considers on every notification, scheduling another flush: a
    // self-sustaining loop of empty commits (~8/sec measured) that cancels any
    // search read slower than its cadence before it can land.
    if (
      committed.length > 0 ||
      settledEmpty.length > 0 ||
      toRemove.length > 0 ||
      totalPendingCount() !== lastNotifiedPending
    ) {
      lastNotifiedPending = totalPendingCount();
      notifyCoverage();
    }
    lastResult = {
      committed,
      failed: !persisted,
      settledEmpty,
      stillPending: [...pendingToAdd],
    };
    return lastResult;
  }

  async function removeEntries(ids: string[]): Promise<void> {
    for (const id of ids) {
      written.delete(id);
      pending.delete(id);
    }
    try {
      await store.removeEntries(conversationId, ids);
    } catch (error) {
      // Same posture as the write: a stale entry that outlives its row is better
      // than a rejected delete, and the row is gone from the transcript so it
      // cannot be clicked. Re-indexing the conversation repairs it.
      if (isStorageExhausted(error)) {
        reportStorageFull();
      }
    }
    // Refs, alongside the text rows and for the same reason: a deleted or hidden
    // message whose refs survived would go on showing its media and links in the
    // panel, which is the "delete for me" promise broken in the one place the user
    // goes looking for the conversation's contents.
    try {
      await store.removeSharedRefs(conversationId, ids);
    } catch {
      // A rejected refs delete is repaired by the next re-index of the message, and
      // the row is already gone from the transcript either way. Never surfaced:
      // the text delete above is the one the search bar reports on, and a failure
      // here must not turn a successful delete into a visible error.
    }
  }

  function schedule(): void {
    if (deferring || disposed) {
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
  function enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const previous = batchChain;
    let release!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- a mutex handoff has no async/await form
    batchChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (async () => {
      await previous;
      try {
        await operation();
      } finally {
        release();
      }
    })();
    return run;
  }

  function enqueueBatch(): Promise<void> {
    return enqueueOperation(async () => {
      await writeBatch();
    });
  }

  async function flush(): Promise<MessageIndexFlushResult> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // oxlint-disable no-await-in-loop -- passes are sequential so batches never overlap
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const seen = batchEpoch;
      await enqueueBatch();
      if (batchEpoch === seen) {
        break;
      }
    }
    // oxlint-enable no-await-in-loop
    return lastResult;
  }

  // Pending rows are retried when their payload finally lands, not only when the
  // next batch happens to include them. Without this a row that missed its window
  // waited for unrelated activity, and a quiet conversation never caught up.
  if (subscribeToPayloads) {
    try {
      unsubscribeFromPayloads = subscribeToPayloads(() => {
        if (pending.size > 0) {
          schedule();
        }
      });
    } catch {
      unsubscribeFromPayloads = null;
    }
  }

  void (async () => {
    try {
      const count = await store.countPending(conversationId);
      if (!disposed && !pendingCountMutated) {
        pendingCount = count;
        if (pendingCount !== lastNotifiedPending) {
          lastNotifiedPending = pendingCount;
          notifyCoverage();
        }
      }
    } catch {
      // The walk rechecks each bounded history page if the queue cannot be read.
    }
  })();

  return {
    consider(messages) {
      if (disposed) {
        return;
      }
      for (const message of messages) {
        const current = getWrittenState(message.id);
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
        unpersistedPending.add(message.id);
        batchEpoch += 1;
        schedule();
      }
    },

    coverage() {
      return {
        indexedCount: written.size,
        pendingCount: totalPendingCount(),
      };
    },

    dispose() {
      if (!disposed) {
        disposed = true;
        try {
          unsubscribeFromPayloads?.();
        } catch {
          // Cleanup cannot prevent the last durable flush from running.
        }
        unsubscribeFromPayloads = null;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        deferring = false;
      }
      return flush();
    },

    async durablePending(messageIds) {
      const pendingIds = await store.hasPendingMessages(
        conversationId,
        messageIds
      );
      return [...pendingIds];
    },

    flush,

    remove(messageIds) {
      if (disposed || messageIds.length === 0) {
        return;
      }
      for (const id of messageIds) {
        pending.delete(id);
        unpersistedPending.delete(id);
      }
      const ids = [...new Set(messageIds)];
      void enqueueOperation(async () => {
        await removeEntries(ids);
        try {
          pendingCount = await store.updatePending(conversationId, {
            remove: ids,
          });
          pendingCountMutated = true;
          for (const id of ids) {
            unpersistedPending.delete(id);
          }
          if (pendingCount !== lastNotifiedPending) {
            lastNotifiedPending = pendingCount;
            notifyCoverage();
          }
        } catch {
          // A stale pending id is harmless; the next queue pass or page walk heals it.
        }
      });
      notifyCoverage();
    },

    setDeferring(next) {
      if (disposed || deferring === next) {
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
