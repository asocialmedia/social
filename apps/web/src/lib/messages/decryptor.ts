import { decryptMessageWithBaseKey } from "./crypto";
import type { MessagePayload } from "./crypto";

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
  cacheCap?: number;
  concurrency?: number;
  decrypt?: DecryptImpl;
  scheduleFlush?: (flush: () => void) => void;
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_CACHE_CAP = 2000;

const defaultDecrypt: DecryptImpl = (item, baseKey) =>
  decryptMessageWithBaseKey(
    baseKey,
    item.message.senderId,
    item.conversationId,
    item.message
  );

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
  getVersion: () => number;
  request: (items: DecryptItem[], keys: DecryptorKeySource) => void;
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

  let scopeKey: string | null = null;
  let generation = 0;
  const entries = new Map<string, DecryptEntry>();
  const inFlight = new Set<string>();
  const queued = new Set<string>();
  const queue: DecryptItem[] = [];
  // Imported HKDF base keys, one per conversation: skips the importKey
  // round-trip for every message after the first without changing the
  // derived keys. Scoped to the identity generation like the payloads.
  const baseKeys = new Map<string, Promise<CryptoKey[]>>();
  let active = 0;
  let version = 0;
  let flushScheduled = false;
  let lastKeys: DecryptorKeySource | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    version += 1;
    // Set iteration skips entries deleted mid-loop, so an unsubscribe
    // inside a listener cannot corrupt the broadcast.
    for (const listener of listeners) {
      listener();
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
    while (entries.size > cacheCap) {
      let victim: string | undefined;
      for (const [id, entry] of entries) {
        if (entry !== "pending" && !inFlight.has(id) && !isMediaEntry(entry)) {
          victim = id;
          break;
        }
      }
      if (victim === undefined) {
        const workPending = queued.size > 0 || inFlight.size > 0;
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
    }
  }

  function pump(): void {
    if (!lastKeys) {
      return;
    }
    while (active < concurrency && queue.length > 0) {
      const item = queue.shift();
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
    entries.set(id, payload ?? "error");
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
          entries.delete(id);
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
      queued.clear();
      queue.length = 0;
      baseKeys.clear();
      // Runs still in flight belong to the old generation; their completions
      // are dropped by the generation guard in run(). Clearing the bookkeeping
      // here lets the new scope start at full concurrency immediately instead
      // of waiting on (and being throttled by) the previous identity's work.
      inFlight.clear();
      active = 0;
      notify();
    },

    get(id: string): DecryptEntry | undefined {
      return entries.get(id);
    },

    getVersion(): number {
      return version;
    },

    request(items: DecryptItem[], keys: DecryptorKeySource): void {
      lastKeys = keys;
      let marked = false;
      for (const item of items) {
        const { id } = item.message;
        if (entries.has(id) || queued.has(id) || inFlight.has(id)) {
          continue;
        }
        entries.set(id, "pending");
        queued.add(id);
        queue.push(item);
        marked = true;
      }
      if (marked) {
        notify();
      }
      pump();
    },

    retry(id: string): void {
      const existed = entries.delete(id);
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
