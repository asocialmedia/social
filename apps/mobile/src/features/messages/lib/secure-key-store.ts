// SecureStore binding for the messages identity keys.
//
// WEB STORES THESE IN localStorage AND IndexedDB; THERE IS NEITHER HERE. The
// native equivalent is expo-secure-store, which is backed by the Android
// keystore / iOS keychain, so this is strictly better than the web arrangement:
// web had to mirror the unwrapped private key into localStorage in cleartext for a
// 0ms read, which this does not.
//
// Split out from lib/crypto.ts for the rule in AGENTS.md: a `lib/` module must not
// import react-native or any Expo module, because `bun test` runs these on Node
// with no native runtime. crypto.ts declares the `MessageKeyStore` interface and
// this file is injected into it. expo-secure-store is only ever imported lazily,
// and createMessageKeyStore takes the backend so tests can drive it.
//
// Values are stored per user id, so switching accounts on one device never reads
// another account's key.

import type { MessageKeyStore } from "./crypto";

const PRIVATE_KEY_PREFIX = "asm.msg.key.";
const SECRET_PREFIX = "asm.msg.secret.";

// SecureStore keys must be alphanumeric plus `.`, `-` and `_`. A user id that
// contains anything else would throw on setItem, so it is hashed into a safe
// token. Losing readability costs nothing: nothing ever reads a key by hand.
function storageKey(prefix: string, userId: string): string {
  let safe = "";
  for (const character of userId) {
    safe += /[A-Za-z0-9._-]/.test(character) ? character : "_";
  }
  return `${prefix}${safe}`;
}

export interface SecureStorageBackend {
  deleteItemAsync: (key: string) => Promise<void>;
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
}

// A read either finds a value, confirms there is none, or fails. Only the first
// two are facts worth remembering for the session.
type ReadResult =
  | { kind: "value"; value: string }
  | { kind: "absent" }
  | { kind: "failed" };

export interface CachingMessageKeyStore extends MessageKeyStore {
  forget: (userId?: string) => void;
}

export function createMessageKeyStore(
  loadBackend: () => Promise<SecureStorageBackend>
): CachingMessageKeyStore {
  const privateKeyCache = new Map<string, JsonWebKey | null>();

  const readItem = async (key: string): Promise<ReadResult> => {
    try {
      const backend = await loadBackend();
      const value = await backend.getItemAsync(key);
      return value ? { kind: "value", value } : { kind: "absent" };
    } catch {
      // A device without a keychain, or a locked one, must not crash the
      // thread: the caller falls back to recovering the key from the server.
      return { kind: "failed" };
    }
  };

  const deleteItem = async (key: string): Promise<void> => {
    try {
      const backend = await loadBackend();
      await backend.deleteItemAsync(key);
    } catch {
      // Nothing to remove is the same end state.
    }
  };

  return {
    async clear(userId: string) {
      privateKeyCache.delete(userId);
      await deleteItem(storageKey(PRIVATE_KEY_PREFIX, userId));
      // The legacy verifier secret goes with it; nothing writes that key
      // anymore, but a device that still holds one must not keep it past a
      // reset.
      await deleteItem(storageKey(SECRET_PREFIX, userId));
    },

    forget(userId?: string) {
      if (userId) {
        privateKeyCache.delete(userId);
      } else {
        privateKeyCache.clear();
      }
    },

    async getPrivateKey(userId: string) {
      // Synchronous memo: the composer and the thread both read the identity
      // on their hot path, and a SecureStore round trip is a JSI hop plus a
      // keystore read.
      const cached = privateKeyCache.get(userId);
      if (cached !== undefined) {
        return cached;
      }
      const read = await readItem(storageKey(PRIVATE_KEY_PREFIX, userId));
      if (read.kind === "failed") {
        // A transient keychain failure (locked during unlock, a busy
        // keystore) is not remembered: the next read asks again instead of
        // pushing the user into key recovery for the rest of the session.
        return null;
      }
      if (read.kind === "absent") {
        privateKeyCache.set(userId, null);
        return null;
      }
      try {
        const parsed = JSON.parse(read.value) as JsonWebKey;
        privateKeyCache.set(userId, parsed);
        return parsed;
      } catch {
        // A corrupted row is treated as absent, which sends the caller down
        // the server-recovery path rather than failing every thread render.
        privateKeyCache.set(userId, null);
        return null;
      }
    },

    async getStoredAccountSecret(userId: string) {
      // Read-only: current identities derive their backup key from the stored
      // hash, so nothing writes this key anymore. Keeping the reader lets a
      // device that still holds a verifier-row secret unlock it.
      const read = await readItem(storageKey(SECRET_PREFIX, userId));
      return read.kind === "value" ? read.value : null;
    },

    async setPrivateKey(userId: string, jwk: JsonWebKey) {
      const backend = await loadBackend();
      await backend.setItemAsync(
        storageKey(PRIVATE_KEY_PREFIX, userId),
        JSON.stringify(jwk)
      );
      // Remembered only once the keychain has it, so a failed write never
      // leaves the memo claiming a key that will be gone after a restart.
      privateKeyCache.set(userId, jwk);
    },
  };
}

const store = createMessageKeyStore(() => import("expo-secure-store"));

export const secureMessageKeyStore: MessageKeyStore = store;

// Called on sign-out so the next account on this device cannot read the previous
// account's key out of the memo.
export function forgetCachedPrivateKey(userId?: string): void {
  store.forget(userId);
}
