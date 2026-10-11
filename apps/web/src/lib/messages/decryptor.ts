import { decryptMessageWithBaseKey } from "./crypto";
import type { MessagePayload } from "./crypto";
import { offlineSearchWorkerClient } from "./offline-search-worker-client";

// Batched, priority-ordered message decrypt scheduler shared by every message
// thread in the session.
//
// Why this exists: the thread used to fire one unthrottled decrypt per
// message plus one setState per result, so opening a long chat spawned
// hundreds of concurrent WebCrypto derivations and re-rendered the whole
// transcript per message. This scheduler instead:
// - decrypts each message id at most once per identity scope (LRU payload
//   cache survives thread remounts and conversation switches),
// - runs at most `concurrency` decryptions at once,
// - processes ids in caller-provided priority order (visible rows first),
// - coalesces completions into one notification per microtask checkpoint,
//   so a batch of results re-renders subscribers once.
//
// Entries are terminal ("payload" | "error") except transient "pending".
// "error" never auto-retries: the thread clears errors when keys change and
// re-requests, so permanently broken payloads do not flap on every scroll.

export type DecryptEntry = MessagePayload | "error" | "pending";

export interface DecryptItem {
  conversationId: string;
  message: {
    ciphertext: string;
    id: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  };
}

export interface DecryptorKeySource {
  // Candidate ratchet base keys for a conversation, newest root-key epoch
  // first. A member can hold several wraps after an identity reset rotates the
  // conversation to a new epoch, and a message's epoch is only discoverable by
  // attempting decryption, so the decryptor tries each in order. A wrong root
  // fails the AES-GCM tag cleanly. Empty means the key is not available yet.
  getBaseKeys: (conversationId: string) => Promise<CryptoKey[]>;
}

export type DecryptImpl = (
  item: DecryptItem,
  baseKey: CryptoKey
) => Promise<MessagePayload>;

export interface DecryptorOptions {
  cacheBytesCap?: number;
  cacheCap?: number;
  concurrency?: number;
  decrypt?: DecryptImpl;
  scheduleFlush?: (flush: () => void) => void;
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_CACHE_CAP = 512;
const DEFAULT_CACHE_BYTES_CAP = 8 * 1024 * 1024;
export const MESSAGE_DECRYPTOR_QUEUE_CAP = 128;
export const MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP = 128;

// How many decrypted payloads the cache holds before evicting. Exported because
// it is also the ceiling on what any consumer can usefully ask to decrypt: a
// request for more than this would decrypt rows and immediately evict them again,
// so a caller that wants "everything" must page instead (see the details panel's
// bulk request in message-thread.tsx).
export const MESSAGE_DECRYPTOR_CACHE_CAP = DEFAULT_CACHE_CAP;
export const MESSAGE_DECRYPTOR_CACHE_BYTES_CAP = DEFAULT_CACHE_BYTES_CAP;

// Shared empty set returned for conversations with no failures, so the common
// case allocates nothing.
const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

function payloadByteLength(payload: MessagePayload): number {
  let characters = 0;
  let objectOverhead = 128;
  if ("content" in payload && typeof payload.content === "string") {
    characters += payload.content.length;
  }
  if ("replyToId" in payload && payload.replyToId) {
    characters += payload.replyToId.length;
    objectOverhead += 32;
  }
  if ("replyToSenderId" in payload && payload.replyToSenderId) {
    characters += payload.replyToSenderId.length;
    objectOverhead += 32;
  }
  if (payload.type === "post") {
    characters += payload.postId.length;
  }
  if (payload.type === "media") {
    if ("images" in payload) {
      characters += payload.images.reduce(
        (sum, image) => sum + image.url.length,
        0
      );
      objectOverhead += payload.images.length * 64;
    } else {
      characters += payload.url.length;
      objectOverhead += 64;
    }
  }
  return objectOverhead + characters * 2;
}

const defaultDecrypt: DecryptImpl = async (item, baseKey) => {
  const workerResult = await offlineSearchWorkerClient.decrypt(
    {
      conversationId: item.conversationId,
      message: item.message,
    },
    baseKey
  );
  if (workerResult.status === "decrypted") {
    return workerResult.payload;
  }
  if (workerResult.status === "failed") {
    throw new Error("Message decryption failed");
  }
  return await decryptMessageWithBaseKey(
    baseKey,
    item.message.senderId,
    item.conversationId,
    item.message
  );
};

// Whether a terminal entry is a decrypted media payload. Media entries are the
// expensive-to-reproduce class (they back the fullscreen viewer's index), so
// they are evicted only once no text/post/error entry is left to drop.
function isMediaEntry(entry: DecryptEntry): boolean {
  return typeof entry === "object" && entry.type === "media";
}

export interface MessageDecryptor {
  clearErrors: () => void;
  // Drops the cached per-conversation base keys so the next request re-resolves
  // them from the supplied key source. Called when the identity changes (an
  // identity reset), where retaining the previous epoch's roots would keep
  // decrypting with keys the new identity is not meant to use.
  clearKeys: () => void;
  configureScope: (scopeKey: string) => void;
  get: (id: string) => DecryptEntry | undefined;
  // Ids whose last attempt failed in `conversationId`. The thread watches these
  // to self-heal a stale key snapshot (see the keys.rotated handling): a failure
  // is the only signal that the cached wraps/peer key may be out of date. Scoped
  // to one conversation so an unrelated thread's failures cannot trigger a
  // refetch here. Returns a live set, so callers must not mutate it.
  getErroredIds: (conversationId: string) => ReadonlySet<string>;
  getVersion: () => number;
  // Drops an id's terminal entry so the next request re-decrypts it from the
  // (possibly rewritten) row. Used by message edits: the ciphertext changed but
  // the id and ratchet index did not, so the cached plaintext is stale. Unlike
  // retry(), an in-flight run is left alone — a second concurrent decrypt of
  // the same id would only race the first's write.
  invalidate: (id: string) => void;
  // Returns items refused by the bounded background queue. They remain
  // unrequested, so a caller can apply backpressure and retry them safely.
  request: (items: DecryptItem[], keys: DecryptorKeySource) => DecryptItem[];
  getBackgroundQueueLength: () => number;
  // Same as `request`, but the batch is served before everything already queued.
  //
  // The queue is otherwise strictly first-in-first-out, and the biggest producer
  // on a fresh device is the search backfill: 500 rows a page, 250ms apart,
  // indefinitely. A search jump then asks for exactly one row -- the one the user
  // is staring at -- and it goes to the back of that stream. The jump's own text
  // budget is a few seconds, so the row can time out while sitting in a queue
  // nobody is waiting on, and the transcript shows a bubble with no text and no
  // explanation.
  //
  // An id already queued in the background lane is PROMOTED rather than dropped
  // and re-added, so a promotion cannot decrypt a row twice or lose it.
  requestUrgent: (items: DecryptItem[], keys: DecryptorKeySource) => void;
  retry: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createDecryptor(
  options: DecryptorOptions = {}
): MessageDecryptor {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const cacheCap = options.cacheCap ?? DEFAULT_CACHE_CAP;
  const cacheBytesCap = options.cacheBytesCap ?? DEFAULT_CACHE_BYTES_CAP;
  const decrypt = options.decrypt ?? defaultDecrypt;
  const scheduleFlush =
    options.scheduleFlush ??
    ((flush: () => void) => {
      queueMicrotask(flush);
    });

  let scopeKey: string | null = null;
  let generation = 0;
  const entries = new Map<string, DecryptEntry>();
  const entryByteLengths = new Map<string, number>();
  let cachedPayloadBytes = 0;
  // Ids currently mapped to "error", bucketed by conversation so a thread can
  // ask "did anything fail in THIS conversation" without seeing another
  // thread's failures (the cache is a session-wide singleton). Maintained
  // alongside `entries` so the lookup never scans the whole cache.
  const erroredByConversation = new Map<string, Set<string>>();
  // Which conversation each tracked id belongs to, so an error can be filed
  // (and later cleared) under the right bucket. Bounded by the entry cache: an
  // id is removed here when it leaves `entries`.
  const conversationById = new Map<string, string>();
  const inFlight = new Set<string>();
  // Ids whose in-flight decrypt predates an edit (invalidate called while the
  // run was still going). The run's result is stale by definition, so when it
  // lands it is dropped and the entry returns to unrequested — the row's
  // self-heal then re-requests and decrypts the rewritten bytes.
  const staleInFlight = new Set<string>();
  const queued = new Set<string>();
  // Two lanes, drained urgent-first. One FIFO queue could not express "the user
  // is waiting on this one row"; see `requestUrgent`.
  const queue: DecryptItem[] = [];
  const urgentQueue: DecryptItem[] = [];
  // Imported HKDF base keys, one per conversation: skips the importKey
  // round-trip for every message after the first without changing the
  // derived keys. Scoped to the identity generation like the payloads.
  const baseKeys = new Map<string, Promise<CryptoKey[]>>();
  let active = 0;
  let version = 0;
  let flushScheduled = false;
  let lastKeys: DecryptorKeySource | null = null;
  const listeners = new Set<() => void>();

  function removeEntry(id: string): boolean {
    const removed = entries.delete(id);
    const byteLength = entryByteLengths.get(id) ?? 0;
    cachedPayloadBytes = Math.max(0, cachedPayloadBytes - byteLength);
    entryByteLengths.delete(id);
    return removed;
  }

  function storeEntry(id: string, entry: DecryptEntry): void {
    removeEntry(id);
    entries.set(id, entry);
    if (typeof entry === "object") {
      const byteLength = payloadByteLength(entry);
      entryByteLengths.set(id, byteLength);
      cachedPayloadBytes += byteLength;
    }
  }

  function notify(): void {
    version += 1;
    // Set iteration skips entries deleted mid-loop, so an unsubscribe
    // inside a listener cannot corrupt the broadcast.
    for (const listener of listeners) {
      listener();
    }
  }

  // Records `id` as errored in its conversation bucket (creating the bucket on
  // demand) and remembers the id's conversation for later cleanup.
  function markErrored(id: string, conversationId: string): void {
    conversationById.set(id, conversationId);
    const bucket = erroredByConversation.get(conversationId);
    if (bucket) {
      bucket.add(id);
    } else {
      erroredByConversation.set(conversationId, new Set([id]));
    }
  }

  // Removes `id` from its error bucket (if any) and forgets its conversation.
  // Called whenever an id stops being an error, leaves the cache, or is
  // retried.
  function clearErrored(id: string): void {
    const conversationId = conversationById.get(id);
    if (conversationId === undefined) {
      return;
    }
    conversationById.delete(id);
    const bucket = erroredByConversation.get(conversationId);
    if (!bucket) {
      return;
    }
    bucket.delete(id);
    if (bucket.size === 0) {
      erroredByConversation.delete(conversationId);
    }
  }

  function scheduleNotify(): void {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    scheduleFlush(() => {
      flushScheduled = false;
      notify();
    });
  }

  // Two-pass eviction over the insertion-ordered entry map: prefer dropping the
  // oldest text/post/error entry, and fall back to the oldest media entry so a
  // media-heavy thread still respects the cap.
  //
  // Media completion order is arbitrary, so a media payload can become terminal
  // while the text entries it should lose to are still pending. Evicting media
  // at that instant would defeat the whole point, so while any work is still
  // queued or in flight the fallback is deferred. A hard overshoot ceiling
  // guarantees the cache stays bounded even under sustained scroll, and once the
  // queue drains the cap is enforced (oldest media first).
  const EVICT_HARD_OVERSHOOT = 256;

  function evictIfNeeded(): void {
    while (entries.size > cacheCap || cachedPayloadBytes > cacheBytesCap) {
      let victim: string | undefined;
      for (const [id, entry] of entries) {
        if (entry !== "pending" && !inFlight.has(id) && !isMediaEntry(entry)) {
          victim = id;
          break;
        }
      }
      if (victim === undefined) {
        const workPending =
          queued.size > 0 || urgentQueue.length > 0 || inFlight.size > 0;

        if (
          workPending &&
          entries.size <= cacheCap + EVICT_HARD_OVERSHOOT &&
          cachedPayloadBytes <= cacheBytesCap
        ) {
          break;
        }
        for (const [id, entry] of entries) {
          if (entry !== "pending" && !inFlight.has(id)) {
            victim = id;
            break;
          }
        }
      }
      // Nothing evictable (everything pending/in-flight): stop rather than spin.
      if (victim === undefined) {
        break;
      }
      removeEntry(victim);
      clearErrored(victim);
    }
  }

  function pump(): void {
    if (!lastKeys) {
      return;
    }
    while (active < concurrency) {
      const item =
        urgentQueue.length > 0
          ? urgentQueue.shift()
          : (queue.shift() ?? undefined);
      if (!item) {
        break;
      }
      const { id } = item.message;
      queued.delete(id);
      // Superseded while waiting (scope reset or retry re-queued a fresher
      // entry): skip instead of decrypting twice.
      if (entries.get(id) !== "pending" || inFlight.has(id)) {
        continue;
      }
      inFlight.add(id);
      active += 1;
      void run(item, generation);
    }
  }

  // Claims a batch as pending and enqueues it in the background lane. Returns
  // whether anything was newly claimed, so a caller knows whether a notification
  // is owed.
  function enqueue(items: DecryptItem[]): {
    changed: boolean;
    rejected: DecryptItem[];
  } {
    let marked = false;
    const rejected: DecryptItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const { id } = item.message;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      if (entries.has(id) || queued.has(id) || inFlight.has(id)) {
        continue;
      }
      if (queue.length >= MESSAGE_DECRYPTOR_QUEUE_CAP) {
        rejected.push(item);
        continue;
      }
      entries.set(id, "pending");
      queued.add(id);
      queue.push(item);
      marked = true;
    }
    return { changed: marked, rejected };
  }

  async function run(item: DecryptItem, runGeneration: number): Promise<void> {
    const { id } = item.message;
    let payload: MessagePayload | null = null;
    try {
      // A rejection lands in "error" — a decrypt must never strand "pending".
      payload = await resolvePayload(item).catch(() => null);
    } catch {
      payload = null;
    }
    // A run that outlived its scope must not write results, release slots, or
    // decrement the CURRENT scope's `active`. The generation check guards all
    // shared bookkeeping, not just the entry write.
    if (runGeneration !== generation) {
      return;
    }
    // An edit landed while this run was decrypting: its plaintext is stale.
    // Drop the result and release the entry to unrequested so the row re-queues
    // and decrypts the rewritten ciphertext. Bookkeeping still runs, so the
    // slot is freed and the pump keeps going.
    if (staleInFlight.delete(id)) {
      inFlight.delete(id);
      removeEntry(id);
      clearErrored(id);
      active -= 1;
      evictIfNeeded();
      scheduleNotify();
      pump();
      return;
    }
    storeEntry(id, payload ?? "error");
    if (payload) {
      clearErrored(id);
    } else {
      markErrored(id, item.conversationId);
    }
    // Release this run's slot before deciding on eviction: the just-finished
    // item is no longer in flight, so the "still working" guard in
    // evictIfNeeded sees only genuinely pending work and the final completion
    // can enforce the cap.
    inFlight.delete(id);
    active -= 1;
    evictIfNeeded();
    scheduleNotify();
    pump();
  }

  // Resolves the conversation's cached candidate base keys, then decrypts with
  // the epoch each was wrapped under. A missing key set (unknown conversation
  // keys) is a terminal "error", not a throw.
  async function resolvePayload(
    item: DecryptItem
  ): Promise<MessagePayload | null> {
    if (!lastKeys) {
      return null;
    }
    let candidates = baseKeys.get(item.conversationId);
    if (!candidates) {
      candidates = lastKeys.getBaseKeys(item.conversationId);
      baseKeys.set(item.conversationId, candidates);
      // Neither a rejected unwrap nor an empty list may poison the cache
      // forever. Empty means the keys are not available *yet* (identity still
      // provisioning, first wrapped key not in), so caching it would keep every
      // later request in terminal "error" even after the keys arrive and
      // clearErrors()/retry() are called. Drop the entry so the next request
      // retries; the identity check avoids deleting a newer promise.
      void (async () => {
        let resolved: CryptoKey[] = [];
        try {
          resolved = await candidates;
        } catch {
          resolved = [];
        }
        if (
          resolved.length === 0 &&
          baseKeys.get(item.conversationId) === candidates
        ) {
          baseKeys.delete(item.conversationId);
        }
      })();
    }
    const resolved = await candidates;
    if (resolved.length === 0) {
      return null;
    }
    // Newest epoch first. The wrong root fails the AES-GCM tag, so a message
    // sent under an older epoch simply falls through to its own key. Bounded by
    // the number of epochs a member holds (one per identity reset). Sequential
    // on purpose: each attempt awaits the previous failure, and the first
    // success returns.
    // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
    for (const candidate of resolved) {
      try {
        return await decrypt(item, candidate);
      } catch {
        // Try the next epoch.
      }
    }
    // oxlint-enable no-await-in-loop
    return null;
  }

  return {
    clearErrors(): void {
      let cleared = false;
      for (const [id, entry] of entries) {
        if (entry === "error") {
          removeEntry(id);
          clearErrored(id);
          cleared = true;
        }
      }
      if (cleared) {
        notify();
      }
    },

    clearKeys(): void {
      baseKeys.clear();
    },

    configureScope(key: string): void {
      if (key === scopeKey) {
        return;
      }
      scopeKey = key;
      generation += 1;
      entries.clear();
      entryByteLengths.clear();
      cachedPayloadBytes = 0;
      erroredByConversation.clear();
      conversationById.clear();
      queued.clear();
      queue.length = 0;
      urgentQueue.length = 0;
      baseKeys.clear();
      // Runs still in flight belong to the old generation; their completions
      // are dropped by the generation guard in run(). Clearing the bookkeeping
      // here lets the new scope start at full concurrency immediately instead
      // of waiting on (and being throttled by) the previous identity's work.
      inFlight.clear();
      active = 0;
      staleInFlight.clear();
      notify();
    },

    get(id: string): DecryptEntry | undefined {
      return entries.get(id);
    },

    getBackgroundQueueLength(): number {
      return queue.length;
    },

    getErroredIds(conversationId: string): ReadonlySet<string> {
      return erroredByConversation.get(conversationId) ?? EMPTY_ID_SET;
    },

    getVersion(): number {
      return version;
    },

    invalidate(id: string): void {
      // A run that is still in flight will write its (now stale) result when it
      // lands. Mark it so run() drops that result and re-opens the entry,
      // instead of writing plaintext that predates the edit. A second
      // concurrent decrypt of the same id would only race the first.
      if (inFlight.has(id)) {
        staleInFlight.add(id);
        return;
      }
      const existed = removeEntry(id);
      clearErrored(id);
      queued.delete(id);
      if (existed) {
        notify();
      }
    },

    request(items: DecryptItem[], keys: DecryptorKeySource): DecryptItem[] {
      lastKeys = keys;
      const result = enqueue(items);
      if (result.changed) {
        notify();
      }
      pump();
      return result.rejected;
    },

    requestUrgent(items: DecryptItem[], keys: DecryptorKeySource): void {
      lastKeys = keys;
      // Collected and unshifted as one batch rather than per item, so a multi-row
      // urgent request keeps the order it was asked in.
      const promoted: DecryptItem[] = [];
      for (const item of items) {
        if (promoted.length >= MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP) {
          break;
        }
        const { id } = item.message;
        // Already decrypting: nothing to move, and a second run would race the
        // first's write.
        if (inFlight.has(id)) {
          continue;
        }
        if (queued.has(id)) {
          // Waiting in the background lane. The splice is linear over a bounded
          // queue; a lazy tombstone would make every pump iteration scan it.
          const at = queue.findIndex((waiting) => waiting.message.id === id);
          if (at === -1) {
            // Defensive: `queued` and the array disagreeing would otherwise drop
            // the row silently, leaving it pending forever.
            continue;
          }
          const [moved] = queue.splice(at, 1);
          if (moved) {
            promoted.push(moved);
          }
          continue;
        }
        if (entries.has(id)) {
          // Already terminal (decrypted or failed). Asking again must not
          // re-decrypt it, and must not resurrect a failure as "pending".
          continue;
        }
        storeEntry(id, "pending");
        queued.add(id);
        promoted.push(item);
      }
      if (promoted.length > 0) {
        urgentQueue.unshift(...promoted);
        while (urgentQueue.length > MESSAGE_DECRYPTOR_URGENT_QUEUE_CAP) {
          const dropped = urgentQueue.pop();
          if (!dropped) {
            break;
          }
          const droppedId = dropped.message.id;
          queued.delete(droppedId);
          if (entries.get(droppedId) === "pending") {
            removeEntry(droppedId);
          }
        }
        notify();
      }
      pump();
    },

    retry(id: string): void {
      const existed = removeEntry(id);
      clearErrored(id);
      queued.delete(id);
      // Notify so subscribers see the entry drop back to "unrequested"; the
      // row-level self-heal then re-queues it. Without this a retry that is
      // not immediately followed by a request() would be invisible.
      if (existed) {
        notify();
      }
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Session singleton used by message threads. Scoped by user id (plus the
// identity generation) so a logout/login never serves another account's
// plaintext from the cache.
export const messageDecryptor = createDecryptor();
