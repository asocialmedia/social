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

// The row table went back to one record per row; existing search indexes are
// dropped and rebuilt by walking history, while identity material is never reset.
export const MESSAGES_DB_VERSION = 13;
export const RESET_SEARCH_STORES_BELOW_VERSION = 9;
// The last layout the text-index reset targets. Tests that need "a database from
// before the per-row layout" seed THIS version, not MESSAGES_DB_VERSION - 1: the
// refs stores raised the version without touching the text index, so the version
// below the current one is a layout that is still perfectly valid and must
// survive the upgrade. Deriving the test fixture from the current version is how a
// test ends up asserting that a shipped index gets thrown away.
export const PRE_RESET_SEARCH_DB_VERSION =
  RESET_SEARCH_STORES_BELOW_VERSION - 1;

export const IDENTITY_STORE = "identity-keys";
// The token dictionary and the row-id allocator, one record per conversation. The
// dictionary's ORDER defines the stable posting ids, so it is append-only; the
// allocator is handed out inside the same write transaction that stores the rows
// it allocates, which is what makes concurrent writers impossible to collide.
export const SEARCH_HEADER_STORE = "search-header";
export const SEARCH_META_STORE = "search-meta";
// Rows that exist but are not searchable yet, persisted across sessions. Its own
// store rather than a field on search-meta, because the backfill walk rewrites
// meta on every page and sharing one object reintroduces the read-modify-write
// race that forced the row allocator to be split out.
export const SEARCH_PENDING_STORE = "search-pending";
// Pending rows are keyed individually so retry state stays paginated and does
// not require materializing a conversation's full backlog in JavaScript.
export const SEARCH_PENDING_QUEUE_STORE = "search-pending-queue";
export const SEARCH_POSTINGS_STORE = "search-postings";
// [conversationId, messageId] -> row id. The forward index from an incoming
// message to the row it already occupies, so a write resolves each entry with a
// point read instead of scanning the conversation's rows.
export const SEARCH_ROW_IDS_STORE = "search-row-ids";
// [conversationId, rowIdString] -> one row's facts, its token ids, and whether it
// is still present. One record per row, so a write costs O(batch) rather than
// O(conversation).
export const SEARCH_ROWS_STORE = "search-rows";

export const OFFLINE_SEARCH_DOCUMENTS_STORE = "offline-search-documents";
export const OFFLINE_SEARCH_PAYLOADS_STORE = "offline-search-payloads";
export const OFFLINE_SEARCH_STATE_STORE = "offline-search-state";
export const OFFLINE_SEARCH_TOMBSTONES_STORE = "offline-search-tombstones";
export const OFFLINE_SEARCH_STORES = [
  OFFLINE_SEARCH_DOCUMENTS_STORE,
  OFFLINE_SEARCH_PAYLOADS_STORE,
  OFFLINE_SEARCH_STATE_STORE,
  OFFLINE_SEARCH_TOMBSTONES_STORE,
] as const;
export const OFFLINE_SEARCH_DOCUMENTS_BY_CONVERSATION_INDEX =
  "by-conversation-created-at";
export const OFFLINE_SEARCH_TOMBSTONES_BY_CONVERSATION_INDEX =
  "by-conversation";

// Superseded search shapes. A sealed whole-table record and its separate
// allocator are gone: they held the row table as one blob, so every write
// re-encoded the entire conversation. An index is rebuildable by walking history,
// so these are dropped rather than migrated.
export const OBSOLETE_SEARCH_STORES = [
  "search-alloc",
  "search-entries",
  "search-tables",
];

export const SEARCH_STORES = [
  SEARCH_HEADER_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_ROW_IDS_STORE,
  SEARCH_ROWS_STORE,
  SEARCH_META_STORE,
  SEARCH_PENDING_STORE,
  SEARCH_PENDING_QUEUE_STORE,
] as const;

// The shared-content refs index (the details panel's Media/Posts/Links tabs),
// keyed for a one-sided read rather than for the text index's needs.
//
//   - [conversationId, kind, timeKey] -> one ref. A tab reads "the newest N
//     media, then the next N" as a single descending range over this store, which
//     is why the key carries the kind and a sortable time: the alternative (one
//     record per message, filtered in the client) reads every ref of all three
//     kinds to answer a question about one.
//   - [conversationId, messageId] -> the keys that message owns. A delete or hide
//     cannot find a message's refs from the ref store alone, and this is the only
//     reverse direction anything needs.
export const SHARED_REFS_STORE = "shared-refs";
export const SHARED_REFS_MESSAGE_STORE = "shared-refs-message";
// Per-conversation, per-kind totals, so a tab can label itself without reading a
// page. Its own record because the search meta is rewritten on every backfill
// page and sharing one would reintroduce the read-modify-write race that forced
// the row allocator into its own store.
export const SHARED_REFS_COUNTS_STORE = "shared-refs-counts";

export const SHARED_REFS_STORES = [
  SHARED_REFS_STORE,
  SHARED_REFS_MESSAGE_STORE,
  SHARED_REFS_COUNTS_STORE,
] as const;

// Every store in the database, created if absent. Called from BOTH owners'
// upgradeneeded handlers: the one that opens first builds the whole schema, so
// the other never depends on being the upgrader.
//
// The reset decision uses the versionchange event's oldVersion, not the version
// being requested. The shared builder is unconditional, so either owner can win
// an upgrade and still drop search data whose keying predates the current
// per-row layout. IDENTITY_STORE is deliberately never reset: identity material
// must survive every search-index rebuild.
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
  // schema the other can use. The refs stores are versioned by record (see
  // SHARED_REFS_FORMAT_VERSION) rather than dropped with the text index, so a
  // future text-index rebuild does not throw away a conversation's media and
  // links and make the panel re-walk history to get them back.
  for (const name of [
    IDENTITY_STORE,
    ...SEARCH_STORES,
    ...SHARED_REFS_STORES,
    ...OFFLINE_SEARCH_STORES,
  ]) {
    if (!db.objectStoreNames.contains(name)) {
      const store = db.createObjectStore(name);
      if (name === OFFLINE_SEARCH_DOCUMENTS_STORE) {
        store.createIndex(OFFLINE_SEARCH_DOCUMENTS_BY_CONVERSATION_INDEX, [
          "conversationId",
          "createdAt",
          "id",
        ]);
      }
      if (name === OFFLINE_SEARCH_TOMBSTONES_STORE) {
        store.createIndex(OFFLINE_SEARCH_TOMBSTONES_BY_CONVERSATION_INDEX, [
          "conversationId",
        ]);
      }
    }
  }
  // Superseded shapes are dropped so they cannot be mistaken for a valid index.
  // `search-tables` held a conversation's row table as ONE sealed blob and
  // `search-alloc` its row-id allocator; neither has a readable form here, and
  // reading a leftover record where a header is expected would silently start a
  // conversation's numbering from the wrong place.
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
