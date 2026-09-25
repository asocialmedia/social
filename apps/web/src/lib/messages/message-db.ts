// Shared IndexedDB coordinates for messages.
//
// One database serves two unrelated concerns: the device's identity key
// (crypto.ts) and the local search index (indexeddb-search-index.ts). They MUST
// agree on the version, because IndexedDB rejects an open that requests a version
// LOWER than the database's current one with a VersionError.
//
// That is not hypothetical: the search backend opened this database at v5 while
// the identity store opened the same name at v1, so the first time the search
// index opened, every later identity-key read failed and with it the ability to
// decrypt any DM. Nothing failed visibly; the app simply could not read its own
// messages.
//
// The second, subtler half: object stores are created ONLY inside a
// upgradeneeded transaction, and that transaction runs only when the requested
// version is HIGHER than the current one. So whichever owner opens first at the
// shared version creates the schema, and the second owner's stores would silently
// never exist. Hence ensureMessagesSchema below, which both owners call: whoever
// gets there first creates everything, and the other finds it in place.

export const MESSAGES_DB_NAME = "asm-messages";

// Bump for any change to either owner's schema. Owners reset their OWN stores on
// the version they own and never touch the other's, so a bump costs a rebuilt
// index and never lost identity material.
export const MESSAGES_DB_VERSION = 5;

export const IDENTITY_STORE = "identity-keys";
export const SEARCH_ROWS_STORE = "search-rows";
export const SEARCH_ROW_IDS_STORE = "search-row-ids";
export const SEARCH_POSTINGS_STORE = "search-postings";
export const SEARCH_ALLOC_STORE = "search-alloc";
export const SEARCH_META_STORE = "search-meta";
// Rows that exist but are not searchable yet, persisted across sessions. Its own
// store rather than a field on search-meta, because the backfill walk rewrites
// meta on every page and sharing one object reintroduces the read-modify-write
// race that forced the row allocator to be split out.
export const SEARCH_PENDING_STORE = "search-pending";

export const SEARCH_STORES = [
  SEARCH_ROWS_STORE,
  SEARCH_ROW_IDS_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_ALLOC_STORE,
  SEARCH_META_STORE,
  SEARCH_PENDING_STORE,
] as const;

// Every store in the database, created if absent. Called from BOTH owners'
// upgradeneeded handlers: the one that opens first builds the whole schema, so
// the other never depends on being the upgrader.
//
// `resetStores` is passed only by the search owner, and only for versions whose
// search keying cannot be migrated. Identity material is never in that list, so a
// schema bump can cost a rebuilt index and nothing else.
export function ensureMessagesSchema(
  db: IDBDatabase,
  options?: { resetSearchStoresBelow?: number; version: number }
): void {
  const resetSearchStoresBelow = options?.resetSearchStoresBelow;
  const version = options?.version ?? MESSAGES_DB_VERSION;
  if (
    resetSearchStoresBelow !== undefined &&
    version < resetSearchStoresBelow
  ) {
    for (const name of SEARCH_STORES) {
      if (db.objectStoreNames.contains(name)) {
        db.deleteObjectStore(name);
      }
    }
  }
  for (const name of [
    IDENTITY_STORE,
    ...SEARCH_STORES,
    // Superseded shapes, dropped so they cannot be mistaken for a valid index.
    "search-entries",
  ]) {
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name);
    } else if (name === "search-entries") {
      db.deleteObjectStore(name);
    }
  }
}

// Set on every connection so a second tab upgrading the schema does not sit
// blocked forever behind a connection that will never notice.
export function closeOnVersionChange(db: IDBDatabase): void {
  db.onversionchange = () => {
    db.close();
  };
}
