// Batched, priority-ordered message decrypt scheduler shared by every message
// thread in the session. Ported from apps/web/src/lib/messages/decryptor.ts.
//
// Why this exists: a thread that fired one unthrottled decrypt per message plus
// one state update per result would spawn hundreds of concurrent P-256/HKDF
// derivations on the UI thread and re-render the whole transcript per message.
// This scheduler instead:
// - decrypts each message id at most once per identity scope (the payload cache
//   survives thread remounts and conversation switches),
// - runs at most `concurrency` decryptions at once,
// - processes ids in caller-provided priority order (visible rows first),
// - coalesces completions into one notification per microtask checkpoint, so a
//   batch of results re-renders subscribers once.
//
// Entries are terminal ("payload" | "error") except transient "pending".
// "error" never auto-retries: the thread clears errors when keys change and
// re-requests, so permanently broken payloads do not flap on every scroll.
//
// ONE PORTING CHANGE: the base-key type is `Uint8Array` (a conversation root key)
// rather than WebCrypto's opaque `CryptoKey`, because a ratchet base key on native
// IS the raw root. Everything else -- the two lanes, the eviction policy, the
// stale-in-flight guard -- is unchanged.

import { decryptMessageWithBaseKey } from "./crypto";
import type { MessagePayload } from "./crypto";

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
  // Candidate ratchet base keys for a conversation, newest root-key epoch first.
  // A member can hold several wraps after an identity reset rotates the
  // conversation to a new epoch, and a message's epoch is only discoverable by
  // attempting decryption, so the decryptor tries each in order. A wrong root
  // fails the AES-GCM tag cleanly. Empty means the key is not available yet.
  getBaseKeys: (conversationId: string) => Promise<Uint8Array[]>;
}

// Either shape is accepted because the native decrypt IS synchronous: wrapping a
// synchronous function in `async` purely to satisfy a type is noise, and it forces
// every caller (including tests and any future native fast path) to pay for a
// promise it does not need.
export type DecryptImpl = (
  item: DecryptItem,
  baseKey: Uint8Array
) => MessagePayload | Promise<MessagePayload>;

export interface DecryptorOptions {
  cacheCap?: number;
  concurrency?: number;
  decrypt?: DecryptImpl;
  scheduleFlush?: (flush: () => void) => void;
  scheduleWork?: (work: () => void) => void;
}

const DEFAULT_CONCURRENCY = 4;
// Lower than web's 2000: this is a phone. Each entry is a decrypted payload
// object, and a long thread is re-entered constantly, so a lower ceiling costs
// nothing visible while keeping a decode of a 500-row page off the heap ceiling.
const DEFAULT_CACHE_CAP = 600;

export const MESSAGE_DECRYPTOR_CACHE_CAP = DEFAULT_CACHE_CAP;

// Shared empty set returned for conversations with no failures, so the common case
// allocates nothing.
const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

const defaultDecrypt: DecryptImpl = (item, baseKey) =>
  decryptMessageWithBaseKey(
    baseKey,
    item.message.senderId,
    item.conversationId,
    item.message
  );

// Whether a terminal entry is a decrypted media payload. Media entries are the
// expensive-to-reproduce class, so they are evicted only once no text/post/error
// entry is left to drop.
function isMediaEntry(entry: DecryptEntry): boolean {
  return typeof entry === "object" && entry.type === "media";
}

export interface MessageDecryptor {
  clearErrors: (conversationId?: string) => void;
  // Drops the cached per-conversation base keys so the next request re-resolves
  // them. Called when the identity changes (an identity reset), where retaining
  // the previous epoch's roots would keep decrypting with keys the new identity is
  // not meant to use.
  clearKeys: (conversationId?: string) => void;
  configureScope: (scopeKey: string) => void;
  get: (id: string) => DecryptEntry | undefined;
  // Ids whose last attempt failed in `conversationId`. The thread watches these to
  // self-heal a stale key snapshot: a failure is the only signal that the cached
  // wraps/peer key may be out of date.
  getErroredIds: (conversationId: string) => ReadonlySet<string>;
  getVersion: () => number;
  // Drops an id's terminal entry so the next request re-decrypts it from the
  // (possibly rewritten) row. Used by message edits: the ciphertext changed but the
  // id and ratchet index did not.
  invalidate: (id: string) => void;
  request: (items: DecryptItem[], keys: DecryptorKeySource) => void;
  // Same as `request`, but the batch is served before everything already queued.
  // A jump into a 500-row page then reads the one row the user is staring at
  // instead of waiting behind the whole window.
  requestUrgent: (items: DecryptItem[], keys: DecryptorKeySource) => void;
  retry: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createDecryptor(
  options: DecryptorOptions = {}
): MessageDecryptor {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const cacheCap = options.cacheCap ?? DEFAULT_CACHE_CAP;
  const decrypt = options.decrypt ?? defaultDecrypt;
  const scheduleFlush =
    options.scheduleFlush ??
    ((flush: () => void) => {
      queueMicrotask(flush);
    });

  const scheduleWork = options.scheduleWork ?? ((work: () => void) => work());
  let pumpScheduled = false;

  let scopeKey: string | null = null;
  let generation = 0;
  const entries = new Map<string, DecryptEntry>();
  // Ids currently mapped to "error", bucketed by conversation so a thread can ask
  // "did anything fail in THIS conversation" without seeing another thread's
  // failures (the cache is a session-wide singleton).
  const erroredByConversation = new Map<string, Set<string>>();
  const conversationById = new Map<string, string>();
  const inFlight = new Set<string>();
  // Ids whose in-flight decrypt predates an edit (invalidate called while the run
  // was still going). The run's result is stale by definition.
  const staleInFlight = new Set<string>();
  const queued = new Set<string>();
  // Two lanes, drained urgent-first.
  const queue: DecryptItem[] = [];
  const urgentQueue: DecryptItem[] = [];
  const baseKeys = new Map<string, Promise<Uint8Array[]>>();
  let active = 0;
  let version = 0;
  let flushScheduled = false;
  const keySources = new Map<string, DecryptorKeySource>();
  const listeners = new Set<() => void>();

  function notify(): void {
    version += 1;
    // Set iteration skips entries deleted mid-loop, so an unsubscribe inside a
    // listener cannot corrupt the broadcast.
    for (const listener of listeners) {
      listener();
    }
  }

  function markErrored(id: string, conversationId: string): void {
    conversationById.set(id, conversationId);
    const bucket = erroredByConversation.get(conversationId);
    if (bucket) {
      bucket.add(id);
    } else {
      erroredByConversation.set(conversationId, new Set([id]));
    }
  }

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

  // Two-pass eviction: prefer dropping the oldest text/post/error entry, and fall
  // back to the oldest media entry so a media-heavy thread still respects the cap.
  const EVICT_HARD_OVERSHOOT = 128;

  function evictIfNeeded(): void {
    while (entries.size > cacheCap) {
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

        if (workPending && entries.size <= cacheCap + EVICT_HARD_OVERSHOOT) {
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
      entries.delete(victim);
      clearErrored(victim);
    }
  }

  function pump(): void {
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
      // Superseded while waiting (scope reset or a retry re-queued a fresher
      // entry): skip instead of decrypting twice.
      if (entries.get(id) !== "pending" || inFlight.has(id)) {
        continue;
      }
      inFlight.add(id);
      active += 1;
      void run(item, generation);
    }
  }

  function continueWork(): void {
    if (pumpScheduled) {
      return;
    }
    pumpScheduled = true;
    const scheduledGeneration = generation;
    scheduleWork(() => {
      if (scheduledGeneration !== generation) {
        return;
      }
      pumpScheduled = false;
      pump();
    });
  }

  // Claims a batch as pending and enqueues it in the background lane.
  function enqueue(items: DecryptItem[]): boolean {
    let marked = false;
    for (const item of items) {
      const { id } = item.message;
      if (entries.has(id) || queued.has(id) || inFlight.has(id)) {
        continue;
      }
      entries.set(id, "pending");
      conversationById.set(id, item.conversationId);
      queued.add(id);
      queue.push(item);
      marked = true;
    }
    return marked;
  }

  async function run(item: DecryptItem, runGeneration: number): Promise<void> {
    const { id } = item.message;
    let payload: MessagePayload | null = null;
    try {
      // A rejection lands in "error" -- a decrypt must never strand "pending".
      payload = await resolvePayload(item).catch(() => null);
    } catch {
      payload = null;
    }
    // A run that outlived its scope must not write results, release slots, or
    // decrement the CURRENT scope's `active`.
    if (runGeneration !== generation) {
      return;
    }
    // An edit landed while this run was decrypting: its plaintext is stale. Drop
    // the result and release the entry to unrequested so the row re-queues against
    // the rewritten ciphertext.
    if (staleInFlight.delete(id)) {
      inFlight.delete(id);
      entries.delete(id);
      clearErrored(id);
      active -= 1;
      evictIfNeeded();
      scheduleNotify();
      continueWork();
      return;
    }
    entries.set(id, payload ?? "error");
    if (payload) {
      clearErrored(id);
    } else {
      markErrored(id, item.conversationId);
    }
    // Release this run's slot before deciding on eviction, so the "still working"
    // guard in evictIfNeeded sees only genuinely pending work.
    inFlight.delete(id);
    active -= 1;
    evictIfNeeded();
    scheduleNotify();
    continueWork();
  }

  // Resolves the conversation's cached candidate base keys, then decrypts with the
  // epoch each was wrapped under. A missing key set is a terminal "error", not a
  // throw.
  async function resolvePayload(
    item: DecryptItem
  ): Promise<MessagePayload | null> {
    const source = keySources.get(item.conversationId);
    if (!source) {
      return null;
    }
    let candidates = baseKeys.get(item.conversationId);
    if (!candidates) {
      candidates = source.getBaseKeys(item.conversationId);
      baseKeys.set(item.conversationId, candidates);
      // Neither a rejected unwrap nor an empty list may poison the cache forever.
      // Empty means the keys are not available *yet* (identity still
      // provisioning), so caching it would keep every later request in terminal
      // "error" even after the keys arrive.
      void (async () => {
        let resolved: Uint8Array[] = [];
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
    // Newest epoch first. The wrong root fails the AES-GCM tag, so a message sent
    // under an older epoch falls through to its own key. Sequential on purpose:
    // each attempt awaits the previous failure, and the first success returns.
    // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
    for (const candidate of resolved) {
      try {
        // Awaited unconditionally: `decrypt` may be synchronous on native and
        // asynchronous if a key source ever needs a round trip, and the try/catch
        // below has to catch both rejections and throws.
        return await decrypt(item, candidate);
      } catch {
        // Try the next epoch.
      }
    }
    // oxlint-enable no-await-in-loop
    return null;
  }

  return {
    clearErrors(conversationId): void {
      let cleared = false;
      for (const [id, entry] of entries) {
        if (
          entry === "error" &&
          (!conversationId || conversationById.get(id) === conversationId)
        ) {
          entries.delete(id);
          clearErrored(id);
          cleared = true;
        }
      }
      if (cleared) {
        notify();
      }
    },

    clearKeys(conversationId): void {
      for (const id of inFlight) {
        if (!conversationId || conversationById.get(id) === conversationId) {
          staleInFlight.add(id);
        }
      }
      if (conversationId) {
        baseKeys.delete(conversationId);
      } else {
        baseKeys.clear();
      }
    },

    configureScope(key: string): void {
      if (key === scopeKey) {
        return;
      }
      scopeKey = key;
      generation += 1;
      pumpScheduled = false;
      entries.clear();
      erroredByConversation.clear();
      conversationById.clear();
      queued.clear();
      queue.length = 0;
      urgentQueue.length = 0;
      baseKeys.clear();
      keySources.clear();
      // Runs still in flight belong to the old generation; their completions are
      // dropped by the generation guard in run(). Clearing the bookkeeping here
      // lets the new scope start at full concurrency immediately.
      inFlight.clear();
      active = 0;
      staleInFlight.clear();
      notify();
    },

    get(id: string): DecryptEntry | undefined {
      return entries.get(id);
    },

    getErroredIds(conversationId: string): ReadonlySet<string> {
      return erroredByConversation.get(conversationId) ?? EMPTY_ID_SET;
    },

    getVersion(): number {
      return version;
    },

    invalidate(id: string): void {
      // A run that is still in flight will write its (now stale) result when it
      // lands. Mark it so run() drops that result instead of writing plaintext
      // that predates the edit.
      if (inFlight.has(id)) {
        staleInFlight.add(id);
        return;
      }
      const existed = entries.delete(id);
      clearErrored(id);
      queued.delete(id);
      if (existed) {
        notify();
      }
    },

    request(items: DecryptItem[], keys: DecryptorKeySource): void {
      for (const item of items) {
        keySources.set(item.conversationId, keys);
      }
      if (enqueue(items)) {
        notify();
        pump();
      }
    },

    requestUrgent(items: DecryptItem[], keys: DecryptorKeySource): void {
      for (const item of items) {
        keySources.set(item.conversationId, keys);
      }
      // Collected and unshifted as one batch so a multi-row urgent request keeps
      // the order it was asked in.
      const promoted: DecryptItem[] = [];
      for (const item of items) {
        const { id } = item.message;
        if (inFlight.has(id)) {
          continue;
        }
        if (queued.has(id)) {
          // Waiting in the background lane. The splice is linear and runs once per
          // row a user is actually waiting on.
          const at = queue.findIndex((waiting) => waiting.message.id === id);
          if (at === -1) {
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
          // re-decrypt it, nor resurrect a failure as "pending".
          continue;
        }
        entries.set(id, "pending");
        conversationById.set(id, item.conversationId);
        queued.add(id);
        promoted.push(item);
      }
      if (promoted.length > 0) {
        urgentQueue.unshift(...promoted);
        notify();
      }
      pump();
    },

    retry(id: string): void {
      const existed = entries.delete(id);
      clearErrored(id);
      queued.delete(id);
      // Notify so subscribers see the entry drop back to "unrequested"; the
      // row-level self-heal then re-queues it.
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

// Session singleton used by message threads. Scoped by user id (plus the identity
// generation) so a logout/login never serves another account's plaintext.
// Yield between small decrypt batches so long histories never monopolize Hermes.
export const messageDecryptor = createDecryptor({
  scheduleWork: (work) => {
    setTimeout(work, 0);
  },
});
