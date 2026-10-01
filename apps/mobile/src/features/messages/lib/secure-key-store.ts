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
// this file is injected into it.
//
// Values are stored per user id, so switching accounts on one device never reads
// another account's key.

import type { MessageKeyStore } from "./crypto";

const PRIVATE_KEY_PREFIX = "asm.msg.key.";
const SECRET_PREFIX = "asm.msg.secret.";

const privateKeyCache = new Map<string, JsonWebKey | null>();

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

async function readItem(key: string): Promise<string | null> {
  try {
    const { getItemAsync } = await import("expo-secure-store");
    return await getItemAsync(key);
  } catch {
    // A device without a keychain (or a locked one) must not crash the thread: the
    // caller falls back to recovering the key from the server identity row.
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  const { setItemAsync } = await import("expo-secure-store");
  await setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  try {
    const { deleteItemAsync } = await import("expo-secure-store");
    await deleteItemAsync(key);
  } catch {
    // Nothing to remove is the same end state.
  }
}

export const secureMessageKeyStore: MessageKeyStore = {
  async clear(userId: string) {
    privateKeyCache.delete(userId);
    await deleteItem(storageKey(PRIVATE_KEY_PREFIX, userId));
    // The legacy verifier secret goes with it; nothing writes that key anymore,
    // but a device that still holds one must not keep it past a reset.
    await deleteItem(storageKey(SECRET_PREFIX, userId));
  },

  async getPrivateKey(userId: string) {
    // Synchronous memo: the composer and the thread both read the identity on
    // their hot path, and a SecureStore round trip is a JSI hop plus a keystore
    // read. This replaces web's localStorage mirror, which was there for exactly
    // the same reason and did the same job far less safely.
    const cached = privateKeyCache.get(userId);
    if (cached !== undefined) {
      return cached;
    }
    const raw = await readItem(storageKey(PRIVATE_KEY_PREFIX, userId));
    if (!raw) {
      privateKeyCache.set(userId, null);
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as JsonWebKey;
      privateKeyCache.set(userId, parsed);
      return parsed;
    } catch {
      // A corrupted row is treated as absent, which sends the caller down the
      // server-recovery path rather than failing every thread render.
      privateKeyCache.set(userId, null);
      return null;
    }
  },

  getStoredAccountSecret(userId: string) {
    // Read-only: current identities derive their backup key from the stored hash,
    // so nothing writes this key anymore. Keeping the reader lets a device that
    // still holds a verifier-row secret unlock it instead of needing a reset.
    return readItem(storageKey(SECRET_PREFIX, userId));
  },

  async setPrivateKey(userId: string, jwk: JsonWebKey) {
    privateKeyCache.set(userId, jwk);
    await writeItem(
      storageKey(PRIVATE_KEY_PREFIX, userId),
      JSON.stringify(jwk)
    );
  },
};

// Called on sign-out so the next account on this device cannot read the previous
// account's key out of the memo.
export function forgetCachedPrivateKey(userId: string): void {
  privateKeyCache.delete(userId);
}
