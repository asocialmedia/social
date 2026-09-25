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

// The sealed row-table layout changed; existing search indexes are dropped and
// rebuilt by walking history, while identity material is never reset.
export const MESSAGES_DB_VERSION = 8;
export const RESET_SEARCH_STORES_BELOW_VERSION = MESSAGES_DB_VERSION;

export const IDENTITY_STORE = "identity-keys";
// One sealed record per conversation: the complete row table, its key generation,
// and a revision. Replaces the per-row stores, because the table is encrypted as a
// single AEAD blob and per-row records would mean ~400ms of WebCrypto per query.
export const SEARCH_TABLES_STORE = "search-tables";
export const SEARCH_POSTINGS_STORE = "search-postings";
export const SEARCH_ALLOC_STORE = "search-alloc";
export const SEARCH_META_STORE = "search-meta";
// Rows that exist but are not searchable yet, persisted across sessions. Its own
// store rather than a field on search-meta, because the backfill walk rewrites
// meta on every page and sharing one object reintroduces the read-modify-write
// race that forced the row allocator to be split out.
export const SEARCH_PENDING_STORE = "search-pending";

export const OBSOLETE_SEARCH_STORES = [
  "search-entries",
  "search-rows",
  "search-row-ids",
];

export const SEARCH_STORES = [
  SEARCH_TABLES_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_ALLOC_STORE,
  SEARCH_META_STORE,
  SEARCH_PENDING_STORE,
] as const;

// Every store in the database, created if absent. Called from BOTH owners'
// upgradeneeded handlers: the one that opens first builds the whole schema, so
// the other never depends on being the upgrader.
//
// The reset decision uses the versionchange event's oldVersion, not the version
// being requested. The shared builder is unconditional, so either owner can win
// an upgrade and still drop search data whose keying predates the sealed layout.
// IDENTITY_STORE is deliberately never reset: identity material must survive
// every search-index rebuild.
export function ensureMessagesSchema(
  db: IDBDatabase,
  oldVersion: number
): void {
  if (oldVersion < RESET_SEARCH_STORES_BELOW_VERSION) {
    for (const name of SEARCH_STORES) {
      if (db.objectStoreNames.contains(name)) {
        db.deleteObjectStore(name);
      }
    }
  }
  // Current stores are created if absent, so whichever owner opens first builds a
  // schema the other can use.
  for (const name of [IDENTITY_STORE, ...SEARCH_STORES]) {
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name);
    }
  }
  // Superseded shapes are dropped so they cannot be mistaken for a valid index.
  // `search-rows` and `search-row-ids` are the v5 per-row stores: the current
  // sealed table is keyed by conversation, so a leftover row record read under
  // that key would hand back a row id where a sealed table is expected.
  for (const name of OBSOLETE_SEARCH_STORES) {
    if (db.objectStoreNames.contains(name)) {
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
