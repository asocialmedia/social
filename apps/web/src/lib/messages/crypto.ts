import {
  closeOnVersionChange,
  ensureMessagesSchema,
  IDENTITY_STORE,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
} from "./message-db";

export * from "@asm/messages/crypto";
// ---- device-scoped key storage (IndexedDB) -----------------------------------

// The unwrapped identity private key is cached per device so the user does not
// have to re-enter their secret every session. It never leaves this origin.
const IDB_STORE = IDENTITY_STORE;
const LS_KEY_PREFIX = "asm_msg_key_";

function openStore(): Promise<IDBDatabase> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
  return new Promise((resolve, reject) => {
    // The SHARED version, not a private one. Requesting a lower version than the
    // database already has throws VersionError, so opening this at 1 while the
    // search index had created the database at a higher version made identity
    // key storage fail outright.
    const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
    request.addEventListener("upgradeneeded", (event) => {
      // The shared schema builder, so this owner's store exists even when the
      // search index created the database first. It is idempotent and only resets
      // search stores on a version whose keying cannot be migrated, so an
      // identity upgrade never costs a rebuilt index.
      ensureMessagesSchema(request.result, event.oldVersion);
    });
    request.addEventListener("success", () => {
      closeOnVersionChange(request.result);
      resolve(request.result);
    });
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function getStoredPrivateKey(
  userId: string
): Promise<JsonWebKey | null> {
  if (typeof window === "undefined") {
    return null;
  }
  // Try localStorage first for instant 0ms key retrieval
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw) as JsonWebKey;
    }
  } catch {
    // localStorage might be unavailable in restricted webviews
  }

  // Fallback to IndexedDB
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openStore();
      // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
      const jwk = await new Promise<JsonWebKey | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const request = tx.objectStore(IDB_STORE).get(userId);
        request.addEventListener("success", () => {
          resolve((request.result as JsonWebKey) ?? null);
        });
        request.addEventListener("error", () => reject(request.error));
      });
      if (jwk) {
        try {
          localStorage.setItem(
            `${LS_KEY_PREFIX}${userId}`,
            JSON.stringify(jwk)
          );
        } catch {
          // ignore
        }
        return jwk;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function setStoredPrivateKey(
  userId: string,
  jwk: JsonWebKey
): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`${LS_KEY_PREFIX}${userId}`, JSON.stringify(jwk));
    } catch {
      // ignore
    }
  }
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openStore();
      // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(jwk, userId);
        tx.addEventListener("complete", () => resolve());
        tx.addEventListener("error", () => reject(tx.error));
      });
    } catch (error) {
      console.error("Failed to store identity key in IDB:", error);
    }
  }
}

export async function clearStoredPrivateKey(userId: string): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(`${LS_KEY_PREFIX}${userId}`);
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem(`${LS_SECRET_PREFIX}${userId}`);
    } catch {
      // ignore
    }
  }
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await openStore();
      // eslint-disable-next-line promise/avoid-new -- IndexedDB callback API must be wrapped in Promise
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(userId);
        tx.addEventListener("complete", () => resolve());
        tx.addEventListener("error", () => reject(tx.error));
      });
    } catch (error) {
      console.error("Failed to clear identity key from IDB:", error);
    }
  }
}

// ---- device-scoped legacy backup-secret storage ------------------------------

// Storage for the raw secret of the short-lived "verifier" scheme. It is only
// READ now: current identities derive their backup key from the stored hash, so
// nothing writes this key anymore. Keeping the reader lets a device that still
// holds a verifier-row secret unlock it instead of needing a reset.
const LS_SECRET_PREFIX = "asm_msg_secret_";

export function getStoredAccountSecret(userId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(`${LS_SECRET_PREFIX}${userId}`);
  } catch {
    return null;
  }
}
