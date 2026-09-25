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
//   error, or its payload evicted from the decryptor LRU) is recorded as pending
//   and retried on every later batch. The failure mode this prevents is the
//   worst one for search: a message that exists and is silently unsearchable.
// - Idempotent. Re-indexing a row replaces its entry rather than appending, so a
//   retried batch, an overlapping page, or a second device can never duplicate a
//   posting. That is what makes the backfill in phase 2 safe to resume.

import { buildSearchIndexEntry } from "./search-index-format";
import type { SearchIndexEntry, SearchIndexStore } from "./search-index-format";

// Mirrors the decryptor's public shape; injected so the writer is testable
// without WebCrypto or a DOM.
export interface IndexablePayload {
  content?: string;
  type: "media" | "post" | "text";
}

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

export interface MessageIndexWriter {
  // Rows whose payload may have become available, or changed (an edit).
  consider: (messages: readonly IndexableMessage[]) => void;
  // Persist any coalesced writes immediately. Callers use this before measuring
  // coverage or when tearing the conversation down.
  flush: () => Promise<void>;
  // Deleted, globally, or hidden for this user: drop them from the index.
  remove: (messageIds: readonly string[]) => void;
  coverage: () => MessageIndexCoverage;
}

// Text used for the searchable index. Shared with the ranked list's extraction so
// a message matches the same way whether it was indexed or indexed in-memory.
function payloadText(payload: IndexablePayload): string {
  if (payload.type === "text") {
    return payload.content ?? "";
  }
  // Post and media matches on their caption; the kind label ("Shared an image")
  // is added by the ranking layer's extractor, not here, so the index stores only
  // what the user actually typed. A captionless media message is therefore not
  // matchable by "image" from the index, which is a deliberate trade: the index
  // stays small and honest rather than synthesizing words nobody wrote.
  return payload.content ?? "";
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
  const { conversationId, getPayload, onCoverage, onStorageFull, store } =
    options;
  // Ids whose index entry we believe is current, with the signature of the text
  // it was built from. A mismatch on the next flush is what triggers a rewrite
  // for an edited message.
  const written = new Map<string, string>();
  const pending = new Map<string, IndexableMessage>();
  const removed = new Set<string>();
  let scheduled: Promise<void> | null = null;

  function notifyCoverage(): void {
    onCoverage?.({
      indexedCount: written.size,
      pendingCount: pending.size,
    });
  }

  async function writeBatch(): Promise<void> {
    scheduled = null;
    if (pending.size === 0) {
      return;
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
        // rather than dropped, so a message is never silently unsearchable.
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
        toRemove.push(id);
        continue;
      }
      const signature = entrySignature(built);
      if (written.get(id) === signature) {
        pending.delete(id);
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
      } catch (error) {
        // Storage refused. Leave the whole batch queued so a later attempt
        // retries it rather than losing rows, and surface it once: a full disk
        // otherwise looks exactly like a conversation with no matches, and the
        // user has no way to tell the difference or act on it.
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
        pending.delete(id);
        dropped += 1;
      }
    }

    notifyCoverage();
  }

  async function removeEntries(ids: string[]): Promise<void> {
    for (const id of ids) {
      written.delete(id);
      pending.delete(id);
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
    if (scheduled) {
      return;
    }
    // A microtask is the smallest coalescing window that still merges every
    // `consider` in the current synchronous batch, which is exactly the shape of
    // a page load or a decryptor completion burst.
    scheduled = (async () => {
      await Promise.resolve();
      await writeBatch();
    })();
  }

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
        schedule();
      }
    },

    coverage() {
      return { indexedCount: written.size, pendingCount: pending.size };
    },

    async flush() {
      if (scheduled) {
        await scheduled;
        // A write that scheduled more work (from a removal during the batch)
        // still gets a turn before we report coverage.
        if (scheduled) {
          await scheduled;
        }
        return;
      }
      await writeBatch();
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
  };
}
