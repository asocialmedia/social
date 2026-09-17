import { decryptMessageWithBaseKey } from "./crypto";
import type { MessagePayload } from "./crypto";

// Batched, priority-ordered E2EE decrypt scheduler shared by every message
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
  getBaseKey: (conversationId: string) => Promise<CryptoKey | null>;
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

export interface MessageDecryptor {
  clearErrors: () => void;
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
  const baseKeys = new Map<string, Promise<CryptoKey | null>>();
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

  function evictIfNeeded(): void {
    while (entries.size > cacheCap) {
      let evicted = false;
      for (const [id, entry] of entries) {
        if (entry !== "pending" && !inFlight.has(id)) {
          entries.delete(id);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        break;
      }
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
    try {
      // A rejection lands in "error" — a decrypt must never strand "pending".
      // (No try/finally: keep the settled-state write unconditional instead.)
      const payload = await resolvePayload(item).catch(() => null);
      if (runGeneration === generation) {
        entries.set(id, payload ?? "error");
        evictIfNeeded();
      }
    } catch {
      if (runGeneration === generation) {
        entries.set(id, "error");
        evictIfNeeded();
      }
    }
    inFlight.delete(id);
    active -= 1;
    scheduleNotify();
    pump();
  }

  // Resolves the conversation's cached base key, then decrypts. A missing
  // base key (unknown conversation keys) is a terminal "error", not a throw.
  async function resolvePayload(
    item: DecryptItem
  ): Promise<MessagePayload | null> {
    if (!lastKeys) {
      return null;
    }
    let baseKey = baseKeys.get(item.conversationId);
    if (!baseKey) {
      baseKey = lastKeys.getBaseKey(item.conversationId);
      baseKeys.set(item.conversationId, baseKey);
      // A rejected unwrap must not poison the cache forever.
      void (async () => {
        try {
          await baseKey;
        } catch {
          if (baseKeys.get(item.conversationId) === baseKey) {
            baseKeys.delete(item.conversationId);
          }
        }
      })();
    }
    const resolved = await baseKey;
    if (!resolved) {
      return null;
    }
    return decrypt(item, resolved);
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
      entries.delete(id);
      queued.delete(id);
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
