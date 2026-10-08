// IndexedDB backend for the local message search index.
//
// Thin by design: every rule about what an index means lives in
// search-index-format.ts (pure, tested) and in the store contract, so the
// browser backend cannot drift from the tested in-memory reference.
//
// Schema (current):
//
//   header    conversationId                -> { dictionary, nextRow, version }
//   rows      [conversationId, rowIdString] -> { createdAt, messageId, present, preview, senderId, tokenIds, version }
//   row-ids   [conversationId, messageId]   -> row id
//   postings  [conversationId, "t" + tokenId] -> { rows, times, version } per token
//
// A posting list is a PAIR of parallel arrays, not a flat list of row ids. The
// time is what a page is ordered by: row ids are handed out in the order this
// device interned rows, and on a conversation indexed by a backfill descending
// from the newest page that order is INVERTED with respect to time (measured on
// the 200k fixture: row 975 is the newest message, row 44416 the oldest). Carrying
// the time beside the row is what makes the pager's keyset a real seam; see
// `selectNewestFirstWindow`.
//   meta      conversationId                -> coverage cursor
//   pending   conversationId                -> ids not searchable yet
//
// One record per ROW, which is the whole point. A single sealed record per
// conversation was tried and reverted: every `putEntries` re-encoded and
// re-encrypted the ENTIRE conversation's table, so writing one 500-message page
// cost ~1.4s of synchronous AES on the main thread at 200k rows and held the
// write lock long enough to starve every other index read. Writes are O(batch)
// and reads O(results) now.
//
// Two consequences, both deliberate:
//
// - The index is PLAINTEXT at rest, and that is the agreed product decision. It
//   is a local cache that never leaves the device, the server holds no copy of
//   it either way, and its at-rest protection is the OS and the device lock,
//   which is what WhatsApp, Telegram, Signal, iMessage and Slack all rely on.
//   Message payloads are unaffected: they stay encrypted exactly as they are,
//   and no key derivation, unlock path or recovery invariant is involved here.
// - There is no WebCrypto on this path, and inside a transaction nothing is
//   awaited except an IndexedDB request. WebCrypto resolves in a later task, so
//   awaiting it inside a transaction lets the transaction go inactive before the
//   next request is issued (`TransactionInactiveError`).
//
// Because row-id allocation happens INSIDE the single write transaction, two
// writers on one conversation are serialised by IndexedDB and cannot be handed
// the same row id. There is therefore no revision counter, no compare-and-swap
// and no retry loop.
//
// Fail-tolerant: a denied or corrupt database rejects, and every caller reads
// that as "not indexed" rather than letting it reach the transcript.

import {
  ensureMessagesSchema,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  SEARCH_HEADER_STORE,
  SEARCH_META_STORE,
  SEARCH_PENDING_QUEUE_STORE,
  SEARCH_PENDING_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_ROW_IDS_STORE,
  SEARCH_ROWS_STORE,
  SHARED_REFS_COUNTS_STORE,
  SHARED_REFS_MESSAGE_STORE,
  SHARED_REFS_STORE,
} from "./message-db";
import {
  expandPrefixTerm,
  intersectPostingListsWindow,
  rowListAdd,
  rowListRemoveMany,
  rowListToArrays,
  searchIndexRowListFrom,
  SEARCH_INDEX_FORMAT_VERSION,
  unionPostingLists,
} from "./search-index-format";
import type {
  SearchIndexConversationSummary,
  SearchIndexEntry,
  SearchIndexMeta,
  SearchIndexPostingList,
  SearchIndexQueryResult,
  SearchIndexRowFacts,
  SearchIndexRowLookup,
  SearchIndexStore,
} from "./search-index-format";
import {
  buildSharedRefRecords,
  emptySharedRefsCounts,
  isSharedRefKind,
  isSharedRefTimeKey,
  sharedRefRange,
  sharedRefTimeKey,
  SHARED_REFS_FORMAT_VERSION,
} from "./shared-refs-format";
import type {
  SharedRefKind,
  SharedRefRecord,
  SharedRefsCounts,
  SharedRefsPage,
  SharedRefsWriteRow,
} from "./shared-refs-format";

// Name and version are shared with the identity key store, which opens the same
// database. See message-db.ts: disagreeing versions throw VersionError, and the
// identity store is what makes a DM decryptable at all.
const HEADER_STORE = SEARCH_HEADER_STORE;
const META_STORE = SEARCH_META_STORE;
const PENDING_STORE = SEARCH_PENDING_STORE;
const PENDING_QUEUE_STORE = SEARCH_PENDING_QUEUE_STORE;
const POSTINGS_STORE = SEARCH_POSTINGS_STORE;
const ROW_IDS_STORE = SEARCH_ROW_IDS_STORE;
const ROWS_STORE = SEARCH_ROWS_STORE;
const REFS_STORE = SHARED_REFS_STORE;
const REFS_MESSAGE_STORE = SHARED_REFS_MESSAGE_STORE;
const REFS_COUNTS_STORE = SHARED_REFS_COUNTS_STORE;
const SEARCH_STORES = [
  HEADER_STORE,
  META_STORE,
  PENDING_STORE,
  PENDING_QUEUE_STORE,
  POSTINGS_STORE,
  ROW_IDS_STORE,
  ROWS_STORE,
  REFS_STORE,
  REFS_MESSAGE_STORE,
  REFS_COUNTS_STORE,
];

let dbPromise: Promise<IDBDatabase> | null = null;
// Set when another tab's version change closed our connection. The next read
// reopens instead of reusing a handle that can no longer be used.
let staleConnection = false;

function storageUnavailable(): boolean {
  return typeof indexedDB === "undefined";
}

async function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    const existing = await dbPromise;
    // A version change in another tab closes this connection, which leaves the
    // cached promise holding a dead handle. Reopening is the only way back, and
    // without this check every later read fails with InvalidStateError instead
    // of reconnecting.
    if (staleConnection) {
      staleConnection = false;
      dbPromise = null;
    } else {
      return existing;
    }
  }
  // eslint-disable-next-line promise/avoid-new -- IndexedDB open lifecycle is event-based
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
    request.addEventListener("upgradeneeded", (event) => {
      // The shared schema builder, so the search stores exist even when the
      // identity store created this database first.
      ensureMessagesSchema(request.result, event.oldVersion);
    });
    request.addEventListener("success", () => {
      request.result.onversionchange = () => {
        // Flagged before closing so the next read reopens rather than reusing a
        // dead handle.
        staleConnection = true;
        request.result.close();
      };
      resolve(request.result);
    });
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("idb open"))
    );
    request.addEventListener("blocked", () =>
      reject(new Error("idb upgrade blocked by another tab"))
    );
  });
  try {
    dbPromise = pending;
    return await pending;
  } catch (error) {
    // Never cache a failed open: a later attempt should be able to succeed.
    dbPromise = null;
    throw error;
  }
}

// Resolves when the transaction *commits*, not when the last request is issued.
// Resolving on request success would let an abort land after the caller moved
// on, which is how a partial write becomes a silent gap.
//
// Exported for the completion-ordering tests, which need to drive a work callback
// that settles in a later task than its last request: the shape that exposed a
// real-browser-only bug fake-indexeddb will not produce on its own, so it has to
// be constructible rather than waited for.
export async function runTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  // eslint-disable-next-line promise/avoid-new -- IndexedDB transaction lifecycle is event-based
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result: T;
    // The transaction committing is NOT the same as the work being done, and
    // resolving on `complete` alone loses the work's return value.
    //
    // `result` is assigned inside a microtask. A real browser can dispatch
    // `complete` before that microtask runs, so the caller receives `undefined`
    // for work that plainly succeeded -- which is not cosmetic: a caller that
    // believes a write finished queues the next one immediately, and the pile of
    // overlapping readwrite transactions that follows starves later reads until
    // they hang forever. fake-indexeddb is invisible to this because it happens
    // to drain the microtask first.
    //
    // So both conditions are required: the transaction committed AND the work
    // settled. Whichever finishes second resolves the promise.
    let transactionComplete = false;
    let workSettled = false;
    let workFailed = false;
    const settle = () => {
      if (workFailed || !transactionComplete || !workSettled) {
        return;
      }
      resolve(result);
    };
    tx.addEventListener("complete", () => {
      transactionComplete = true;
      settle();
    });
    tx.addEventListener("error", () => {
      workFailed = true;
      reject(tx.error ?? new Error("idb transaction"));
    });
    tx.addEventListener("abort", () => {
      workFailed = true;
      reject(tx.error ?? new Error("idb transaction aborted"));
    });
    void Promise.resolve(work(tx))
      .then((value) => {
        result = value;
        workSettled = true;
        settle();
      })
      .catch((error: unknown) => {
        workFailed = true;
        try {
          tx.abort();
        } catch {
          // Already aborting.
        }
        // Rejected here rather than on the abort event: the work already failed,
        // and waiting on an abort that may never be delivered would leave the
        // caller hanging on a transaction that can no longer succeed.
        reject(error);
      });
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB request lifecycle is event-based
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("idb request"))
    );
  });
}

// Walks a cursor to exhaustion, calling `onRow` for each record.
//
// The listeners are attached once, not per step. A cursor reuses its request for
// every value, so awaiting each step with a fresh listener leaves the previous
// ones attached: step n fires n listeners, making the walk quadratic. One
// self-reusing listener makes it linear. Only the whole-conversation operations
// need it (eviction accounting, listing conversations); the query and write
// paths are all point reads.
function drainCursor(
  request: ReturnType<IDBObjectStore["openCursor"]>,
  onRow: (key: IDBValidKey, value: unknown) => void
): Promise<void> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB cursor lifecycle is event-based
  return new Promise<void>((resolve, reject) => {
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      onRow(cursor.key, cursor.value);
      // Reusing the same request is what makes this one listener enough.
      cursor.continue();
    });
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("idb cursor"))
    );
  });
}

// One row's effect on the index: the token ids it now belongs to, and the ones it
// no longer does.
export interface TokenRowMutation {
  createdAt: number;
  droppedTokenIds: number[];
  row: number;
  tokenIds: number[];
}

// What a single token's posting list needs from one batch: rows to add, rows to
// drop. Both ascending.
export interface TokenListUpdate {
  add: number[];
  drop: number[];
}

// Groups per-row mutations into one update per DISTINCT token.
//
// The batching this exists for is not an optimisation, it is a correctness
// requirement. IndexedDB holds an exclusive write lock on every store in a
// transaction's scope for the transaction's whole life, and Chrome blocks every
// other transaction touching those stores until it commits. Doing a get/put per
// (row x token) meant a 500-message backfill page issued roughly 9,000 requests
// inside one transaction, so a single page locked the index for minutes and the
// backfill's own next read queued behind it and never ran. Per distinct token the
// same page is ~120 requests.
//
// Rows are sorted ascending because that is what `rowListToArrays` would produce
// anyway, so the stored bytes are unchanged, and because appending in order keeps
// `rowListAdd`'s O(1) path instead of falling back to its duplicate scan.
//
// A token can never appear in both `add` and `drop` for one row: adds come from
// the incoming entry's tokens and drops from the previous tokens the entry no
// longer has, which are disjoint by construction. A token may legitimately appear
// in both lists across DIFFERENT rows in the same batch, which is a rewrite, and
// the executor applies drops before adds so the row ends up in the right state.
//
// Pure and exported so the request count it implies is directly assertable:
// fake-indexeddb has no lock contention, so the failure this fixes cannot be
// reproduced there, but "one get and one put per token" can.
export function planTokenListUpdates(
  mutations: readonly TokenRowMutation[]
): Map<number, TokenListUpdate> {
  const adds = new Map<number, number[]>();
  const drops = new Map<number, number[]>();
  for (const mutation of mutations) {
    for (const tokenId of mutation.tokenIds) {
      const bucket = adds.get(tokenId);
      if (bucket) {
        bucket.push(mutation.row);
      } else {
        adds.set(tokenId, [mutation.row]);
      }
    }
    for (const tokenId of mutation.droppedTokenIds) {
      const bucket = drops.get(tokenId);
      if (bucket) {
        bucket.push(mutation.row);
      } else {
        drops.set(tokenId, [mutation.row]);
      }
    }
  }
  const plans = new Map<number, TokenListUpdate>();
  for (const tokenId of adds.keys()) {
    plans.set(tokenId, { add: (adds.get(tokenId) ?? []).toSorted(), drop: [] });
  }
  for (const [tokenId, rows] of drops) {
    const plan = plans.get(tokenId);
    if (plan) {
      plan.drop = rows.toSorted();
    } else {
      plans.set(tokenId, { add: [], drop: rows.toSorted() });
    }
  }
  return plans;
}

// Stores a posting list, deleting the record when it empties. `put` and `delete`
// return differently-typed requests, which a union cannot express here, so both
// branches live in one place rather than at each call site. Deleting an emptied
// list keeps the store free of records that can never match again.
async function writePostingList(
  store: IDBObjectStore,
  key: [string, string],
  list: SearchIndexPostingList
): Promise<void> {
  if (list.rows.length === 0) {
    await requestAsPromise(store.delete(key));
    return;
  }
  const record: StoredPostingList = {
    rows: list.rows,
    times: list.times,
    version: SEARCH_INDEX_FORMAT_VERSION,
  };
  await requestAsPromise(store.put(record, key));
}

// ---- stored records ----------------------------------------------------------

// The token dictionary and the allocator, one record per conversation.
//
// The dictionary is APPEND-ONLY and its order IS the posting ids: a persistent
// backend keys every posting list by these ids, so an existing id must never move
// and no entry may ever be removed. That is what lets a query turn the words a
// user typed into posting keys with a single point read, and it is why the
// dictionary is not sorted on write.
interface StoredHeader {
  dictionary: string[];
  nextRow: number;
  version: number;
}

// One row's facts, the token ids it currently belongs to, and whether it is still
// present.
//
// `present: false` is a tombstone, not a hole: the row existed, its message was
// deleted or hidden, and the record is kept with an empty `tokenIds` so the id is
// never handed out again and a stale device cannot resurrect the deletion. The
// posting lists no longer hold it, so it matches nothing either way.
//
// `messageId` is stored here, once, and in `row-ids` as the lookup key. It has to
// be here: a query resolves matched rows by ROW id, and IndexedDB cannot invert a
// key, so a row → message id projection from `row-ids` alone would need a cursor
// over the whole conversation -- exactly the O(conversation) read this schema
// exists to remove.
interface StoredRow {
  createdAt: number;
  messageId: string;
  present: boolean;
  // Leading message text for the list view's snippets, bounded by
  // SEARCH_INDEX_PREVIEW_LENGTH. Present on every row this build writes;
  // rows from before previews existed fail the version-shape check below and
  // are treated as absent, which is what re-walks the conversation once.
  preview: string;
  senderId: string;
  tokenIds: number[];
  version: number;
}

function isCurrentVersion(value: unknown): value is { version: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === SEARCH_INDEX_FORMAT_VERSION
  );
}

// A record this build cannot read is treated as absent, so the conversation
// re-walks from scratch rather than trusting a shape it does not understand.
function isStoredHeader(value: unknown): value is StoredHeader {
  return (
    isCurrentVersion(value) &&
    "dictionary" in value &&
    Array.isArray(value.dictionary) &&
    "nextRow" in value &&
    typeof value.nextRow === "number"
  );
}

function isStoredRow(value: unknown): value is StoredRow {
  return (
    isCurrentVersion(value) &&
    "createdAt" in value &&
    typeof value.createdAt === "number" &&
    "messageId" in value &&
    typeof value.messageId === "string" &&
    "present" in value &&
    typeof value.present === "boolean" &&
    "preview" in value &&
    typeof value.preview === "string" &&
    "senderId" in value &&
    typeof value.senderId === "string" &&
    "tokenIds" in value &&
    Array.isArray(value.tokenIds)
  );
}

function isStoredMeta(value: unknown): value is SearchIndexMeta {
  return (
    isCurrentVersion(value) &&
    "conversationId" in value &&
    typeof value.conversationId === "string" &&
    "lastAccessedAt" in value &&
    typeof value.lastAccessedAt === "number"
  );
}

// ---- shared-content refs -----------------------------------------------------
//
// Versioned on its own, NOT by `isCurrentVersion`: a future text-index bump
// invalidates the text rows and forces a re-walk, and the refs read here must
// keep working through that. Sharing one version constant would make a text
// search schema change silently empty the details panel's media and links.

// A ref record this build can read. The three kinds are disjoint by shape — a
// post record carries `postId`, a media record `mediaKind` plus `url`, a link
// record `url` alone — so a record cannot pass this check and be unreadable, and
// cannot claim a kind it does not have.
function isStoredRef(value: unknown): value is SharedRefRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === SHARED_REFS_FORMAT_VERSION &&
    "createdAt" in value &&
    typeof value.createdAt === "number" &&
    "index" in value &&
    typeof value.index === "number" &&
    "messageId" in value &&
    typeof value.messageId === "string" &&
    "senderId" in value &&
    typeof value.senderId === "string"
  );
}

function isStoredRefsCounts(value: unknown): value is SharedRefsCounts {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === SHARED_REFS_FORMAT_VERSION &&
    "conversationId" in value &&
    typeof value.conversationId === "string" &&
    "media" in value &&
    typeof value.media === "number" &&
    "post" in value &&
    typeof value.post === "number" &&
    "link" in value &&
    typeof value.link === "number"
  );
}

// Which tab a record belongs to, read off its shape. Mirrors the memory
// backend's helper because the two must classify identically, and a disagreement
// here would show a post in the Links tab only on one backend.
function refKindOf(record: SharedRefRecord): SharedRefKind {
  if (record.postId !== undefined) {
    return "post";
  }
  return record.mediaKind === undefined ? "link" : "media";
}

// The keys a message owns, as stored in the forward index. A record this build
// cannot read reads as "owns nothing", which makes a delete a no-op rather than
// a wrong deletion: the next walk re-derives the message and rewrites it.
function isStoredRefKeys(
  value: unknown
): value is { keys: string[]; version: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === SHARED_REFS_FORMAT_VERSION &&
    "keys" in value &&
    Array.isArray(value.keys)
  );
}

// Deletes a message's refs and decrements the counts, inside the caller's
// transaction. Shared by the write path (an edit that replaced a message's refs)
// and the delete path, so the two can never disagree about what a message owns.
async function deleteRefKeys(
  refStore: IDBObjectStore,
  forwardStore: IDBObjectStore,
  counts: SharedRefsCounts,
  conversationId: string,
  messageId: string
): Promise<void> {
  const stored = await requestAsPromise<unknown>(
    forwardStore.get([conversationId, messageId])
  );
  if (!isStoredRefKeys(stored)) {
    return;
  }
  // oxlint-disable no-await-in-loop -- one readwrite transaction; Promise.all
  // would issue requests outside the transaction's lifetime, which throws
  for (const key of stored.keys) {
    // Stored as `kind\u0000timeKey`, because an IndexedDB key is an array and the
    // forward index is a flat string list: splitting it back is how a delete finds
    // the exact records to remove without a scan.
    const [kind = "", timeKey = ""] =
      typeof key === "string" ? key.split("\u0000") : [];
    if (isSharedRefKind(kind) && timeKey !== "") {
      await requestAsPromise(refStore.delete([conversationId, kind, timeKey]));
      counts[kind] = Math.max(0, counts[kind] - 1);
    }
  }
  await requestAsPromise(forwardStore.delete([conversationId, messageId]));
}

// A stored posting list: the rows, and the creation time of each.
//
// Both arrays travel in one record because they must agree. Split across two
// records, a write that died between them would leave a list whose times belong
// to a different set of rows, and the pager would order messages by each other's
// creation times -- wrong results with nothing visibly broken.
interface StoredPostingList {
  rows: Uint32Array;
  times: Float64Array;
  version: number;
}

function isStoredPostingList(value: unknown): value is StoredPostingList {
  return (
    isCurrentVersion(value) &&
    "rows" in value &&
    value.rows instanceof Uint32Array &&
    "times" in value &&
    value.times instanceof Float64Array
  );
}

// Reads a stored posting list, or an empty one when the record is absent or is a
// shape this build cannot interpret. Empty rather than an error: a v6 list is a
// bare Uint32Array with no times at all, and the write path resets the whole
// conversation for those, so a read only has to not crash on one.
function postingListFrom(stored: unknown): SearchIndexPostingList {
  if (!isStoredPostingList(stored)) {
    return EMPTY_POSTING_LIST;
  }
  return { rows: stored.rows, times: stored.times };
}

function isConversationKey(key: IDBValidKey): key is string {
  return typeof key === "string";
}

function emptyHeader(): StoredHeader {
  return {
    dictionary: [],
    nextRow: 0,
    version: SEARCH_INDEX_FORMAT_VERSION,
  };
}

function emptyQueryResult(): SearchIndexQueryResult {
  return { hasMore: false, rows: new Map(), totalMatched: 0 };
}

const EMPTY_POSTING_LIST: SearchIndexPostingList = {
  rows: new Uint32Array(0),
  times: new Float64Array(0),
};

// ---- keys --------------------------------------------------------------------

// A posting list is keyed by the token's DICTIONARY ID, never by its text, so
// the key stays a small integer however long the word is.
function postingKeyForId(
  conversationId: string,
  tokenId: number
): [string, string] {
  return [conversationId, `t${tokenId}`];
}

// Row ids are interned and dense, so the key component is a small integer
// rendered as a string. That is what makes the key range below cover every row
// of a conversation with one bound.
function rowKey(conversationId: string, row: number): [string, string] {
  return [conversationId, String(row)];
}

function rowIdKey(conversationId: string, messageId: string): [string, string] {
  return [conversationId, messageId];
}

// Range over a conversation's entries in a store keyed [conversationId, string].
// Row ids, token ids and message ids all render as strings, so one bound covers
// all three stores.
function conversationKeyRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound([conversationId, ""], [conversationId, "￿"]);
}

function pendingQueueRange(conversationId: string): IDBKeyRange {
  return conversationKeyRange(conversationId);
}

async function migrateLegacyPendingQueue(
  tx: IDBTransaction,
  conversationId: string
): Promise<void> {
  const legacyStore = tx.objectStore(PENDING_STORE);
  const legacyKey = await requestAsPromise<IDBValidKey | undefined>(
    legacyStore.getKey(conversationId)
  );
  if (legacyKey === undefined) {
    return;
  }
  await requestAsPromise(legacyStore.delete(conversationId));
  const metaStore = tx.objectStore(META_STORE);
  const storedMeta = await requestAsPromise<unknown>(
    metaStore.get(conversationId)
  );
  if (
    isStoredMeta(storedMeta) &&
    storedMeta.conversationId === conversationId
  ) {
    // The legacy value is one unbounded array. Rewriting it as thousands of
    // point records in a single open would block low-memory devices. Drop this
    // derived retry snapshot and rewind only its coverage cursor; the normal
    // paced history walk rediscovers missing rows in bounded pages.
    await requestAsPromise(
      metaStore.put(
        {
          ...storedMeta,
          cursorVerified: false,
          indexedThroughId: null,
          reachedStart: false,
          refsReachedStart: false,
          updatedAt: Date.now(),
        },
        conversationId
      )
    );
  }
}

async function readPendingQueuePage(
  tx: IDBTransaction,
  conversationId: string,
  options: { after?: string; limit: number }
): Promise<string[]> {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(1000, Math.trunc(options.limit)))
    : 256;
  const range = options.after
    ? IDBKeyRange.bound(
        [conversationId, options.after],
        [conversationId, "￿"],
        true,
        false
      )
    : pendingQueueRange(conversationId);
  const messageIds: string[] = [];
  // oxlint-disable-next-line promise/avoid-new -- IndexedDB cursor is event-based
  await new Promise<void>((resolve, reject) => {
    const request = tx.objectStore(PENDING_QUEUE_STORE).openCursor(range);
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor || messageIds.length >= limit) {
        resolve();
        return;
      }
      const messageId = Array.isArray(cursor.key) ? cursor.key[1] : undefined;
      if (typeof messageId === "string") {
        messageIds.push(messageId);
      }
      cursor.continue();
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("idb pending cursor"));
    });
  });
  return messageIds;
}

// The same idea for the refs store's [conversationId, kind, timeKey] keys.
//
// It needs its own bound and cannot borrow the two-part one above: IndexedDB keys
// are ordered arrays, and a bound with two components does not contain keys with
// three. Every component has to be bounded, which is also why the eviction path
// cannot reuse `conversationKeyRange` for this store.
function refsKeyRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [conversationId, "", ""],
    [conversationId, "￿", "￿"]
  );
}

// ---- reads -------------------------------------------------------------------

// The conversation's dictionary and allocator, or the reason there is none to read.
//
// The three cases are kept apart because they are not the same thing. "missing" is
// a conversation nobody has indexed, and the write path must simply start at zero.
// "unusable" is a record this build cannot read, whose posting lists are still on
// disk: the dictionary restarts at id 0 there, so those lists would be adopted by
// unrelated words and inflate every match count. Only a write resets such a
// conversation, and only then. A read treats both as "nothing indexed", which is
// what a caller reading an empty result will rebuild from.
type HeaderRead =
  | { kind: "missing" }
  | { kind: "unusable" }
  | { header: StoredHeader; kind: "usable" };

async function readHeader(
  tx: IDBTransaction,
  conversationId: string
): Promise<HeaderRead> {
  const stored = await requestAsPromise<unknown>(
    tx.objectStore(HEADER_STORE).get(conversationId)
  );
  if (stored === undefined) {
    return { kind: "missing" };
  }
  if (!isStoredHeader(stored)) {
    return { kind: "unusable" };
  }
  // A copy, so the caller can append to the dictionary without mutating what a
  // later structured clone of the store would have produced.
  return {
    header: { ...stored, dictionary: [...stored.dictionary] },
    kind: "usable",
  };
}

// Resolves rows into the shape a caller needs: one point read per row, no cursor,
// tombstones skipped. The cost is bounded by the number of rows asked for rather
// than by the conversation, which is what keeps search memory flat as a thread
// grows.
function readRowFacts(
  conversationId: string,
  rowIds: Iterable<number> & { readonly length: number }
): Promise<SearchIndexRowLookup> {
  if (rowIds.length === 0) {
    return Promise.resolve(new Map());
  }
  return runTransaction([ROWS_STORE], "readonly", async (tx) => {
    const rowsStore = tx.objectStore(ROWS_STORE);
    const out: SearchIndexRowLookup = new Map();
    // oxlint-disable no-await-in-loop -- one transaction, one store, order irrelevant
    for (const row of rowIds) {
      const stored = await requestAsPromise<unknown>(
        rowsStore.get(rowKey(conversationId, row))
      );
      // A tombstone is skipped rather than resolved: the message is gone, so
      // returning it as a searchable result would be wrong.
      if (!isStoredRow(stored) || !stored.present) {
        continue;
      }
      out.set(row, rowFacts(stored));
    }
    // oxlint-enable no-await-in-loop
    return out;
  });
}

function rowFacts(stored: StoredRow): SearchIndexRowFacts {
  return {
    createdAt: stored.createdAt,
    messageId: stored.messageId,
    preview: stored.preview,
    senderId: stored.senderId,
  };
}

function rowFactsCacheKey(conversationId: string, row: number): string {
  return `${conversationId} ${row}`;
}

export function createIndexedDbSearchIndexStore(): SearchIndexStore {
  // Session cache of resolved row facts, keyed `${conversationId} ${row}`.
  // Profiling a 200k-row conversation showed row resolution is ~99% of a
  // keystroke query (header plus posting list read in ~1ms; resolving 2,000 rows
  // costs ~250ms), and consecutive keystrokes re-resolve mostly the same rows.
  // It fills only from verified reads -- never from writes, so an out-of-band
  // change can never be cached over -- and removals and conversation clears
  // invalidate it; absent rows are never cached, because a row created later
  // must be read, not remembered as missing.
  const rowFactsCache = new Map<string, SearchIndexRowFacts>();
  const MAX_CACHED_ROW_FACTS = 2000;
  const cacheRowFacts = (
    conversationId: string,
    row: number,
    facts: SearchIndexRowFacts
  ): void => {
    const key = rowFactsCacheKey(conversationId, row);
    // Refresh recency on hits: Map iterates in insertion order, and the
    // eviction below drops the oldest first.
    if (rowFactsCache.has(key)) {
      rowFactsCache.delete(key);
    } else if (rowFactsCache.size >= MAX_CACHED_ROW_FACTS) {
      const oldest = rowFactsCache.keys().next();
      if (!oldest.done) {
        rowFactsCache.delete(oldest.value);
      }
    }
    rowFactsCache.set(key, facts);
  };
  const dropCachedConversation = (conversationId: string): void => {
    const prefix = `${conversationId} `;
    for (const key of rowFactsCache.keys()) {
      if (key.startsWith(prefix)) {
        rowFactsCache.delete(key);
      }
    }
  };
  // Cached row resolution for the query path. Hits skip IndexedDB entirely;
  // misses resolve through the same point reads as an uncached call, and only
  // present rows are cached -- absent rows must be re-read, because a later
  // write can create them.
  const resolveRowFacts = async (
    conversationId: string,
    rowIds: Iterable<number> & { readonly length: number }
  ): Promise<SearchIndexRowLookup> => {
    const out: SearchIndexRowLookup = new Map();
    const missing: number[] = [];
    for (const row of rowIds) {
      const cached = rowFactsCache.get(rowFactsCacheKey(conversationId, row));
      if (cached) {
        out.set(row, cached);
      } else {
        missing.push(row);
      }
    }
    if (missing.length > 0) {
      const resolved = await readRowFacts(conversationId, missing);
      for (const [row, facts] of resolved) {
        cacheRowFacts(conversationId, row, facts);
        out.set(row, facts);
      }
    }
    return out;
  };
  // One chunk of the hot write: a single readwrite transaction over the rows, the
  // row-id index, the posting lists and the header, and nothing awaited inside it
  // except an IndexedDB request.
  //
  // Row ids are allocated from the header INSIDE this transaction, so IndexedDB's
  // own per-store serialisation is the lock that stops two writers handing out the
  // same id. Nothing is encrypted, so there is no crypto to await between the read
  // and the write, and the transaction never goes inactive.
  function putEntryChunk(
    conversationId: string,
    entries: ReadonlyMap<string, SearchIndexEntry>
  ): Promise<void> {
    return runTransaction(
      [ROWS_STORE, ROW_IDS_STORE, POSTINGS_STORE, HEADER_STORE],
      "readwrite",
      async (tx) => {
        const rowsStore = tx.objectStore(ROWS_STORE);
        const rowIdsStore = tx.objectStore(ROW_IDS_STORE);
        const postingsStore = tx.objectStore(POSTINGS_STORE);
        const headerStore = tx.objectStore(HEADER_STORE);
        const read = await readHeader(tx, conversationId);
        if (read.kind === "unusable") {
          // The dictionary restarts at id 0 here, and the posting lists on disk
          // are keyed by ids this build cannot interpret: left alone they would
          // be adopted by unrelated words and inflate every match count. Reset
          // the conversation to empty and re-index it by walking history.
          // oxlint-disable no-await-in-loop -- sequential range deletes on one transaction
          for (const store of [rowsStore, rowIdsStore, postingsStore]) {
            await requestAsPromise(
              store.delete(conversationKeyRange(conversationId))
            );
          }
          // oxlint-enable no-await-in-loop
          await requestAsPromise(
            headerStore.put(emptyHeader(), conversationId)
          );
        }
        const header = read.kind === "usable" ? read.header : emptyHeader();
        const { dictionary } = header;
        const tokenIdByText = new Map(
          dictionary.map((token, tokenId) => [token, tokenId])
        );
        let { nextRow } = header;
        let allocatorMoved = false;
        let dictionaryGrew = false;
        const mutations: TokenRowMutation[] = [];

        // Sequential on purpose: each entry's row id and prior tokens must be
        // known before its posting lists are updated, and the whole batch is one
        // transaction so the work is atomic rather than concurrent.
        // oxlint-disable no-await-in-loop -- one entry at a time inside one transaction
        for (const [messageId, entry] of entries) {
          // A point read per incoming message id, which is what `row-ids` is
          // for: a batch of entirely new messages never scans anything, and a
          // rewrite finds its row without walking the conversation.
          const existing = await requestAsPromise<number | undefined>(
            rowIdsStore.get(rowIdKey(conversationId, messageId))
          );
          let row = existing;
          let previous: StoredRow | null = null;
          if (row === undefined) {
            row = nextRow;
            nextRow += 1;
            allocatorMoved = true;
            await requestAsPromise(
              rowIdsStore.put(row, rowIdKey(conversationId, messageId))
            );
          } else {
            const stored = await requestAsPromise<unknown>(
              rowsStore.get(rowKey(conversationId, row))
            );
            if (!isStoredRow(stored)) {
              // A row this build cannot read is left exactly as it is. Its
              // posting membership cannot be computed from a shape we cannot
              // parse, and overwriting it would drop rows the posting lists
              // still reference.
              continue;
            }
            if (!stored.present) {
              // A tombstone must not be revived by a stale device's re-index.
              continue;
            }
            previous = stored;
          }
          // Assign ids to this entry's tokens, appending to the dictionary.
          // Append-only: an existing id must never move, because it is what
          // the posting lists are keyed by.
          const tokenIds: number[] = [];
          for (const token of entry.tokens) {
            let tokenId = tokenIdByText.get(token);
            if (tokenId === undefined) {
              tokenId = dictionary.length;
              tokenIdByText.set(token, tokenId);
              dictionary.push(token);
              dictionaryGrew = true;
            }
            tokenIds.push(tokenId);
          }
          // A token the rewrite dropped must leave the posting list too, or the
          // message would keep matching a word it no longer contains. The row's
          // own tokenIds are the reverse index, so this costs nothing to know.
          const kept = new Set(tokenIds);
          const droppedTokenIds: number[] = [];
          for (const oldTokenId of previous?.tokenIds ?? []) {
            if (!kept.has(oldTokenId)) {
              droppedTokenIds.push(oldTokenId);
            }
          }
          // The row's ORIGINAL creation time, not the incoming entry's: an edit
          // carries the same message, and a stale device must not be able to
          // reorder history by rewriting a row with a different timestamp.
          const createdAt = previous?.createdAt ?? entry.createdAt;
          mutations.push({ createdAt, droppedTokenIds, row, tokenIds });
          // A rewrite carries the row's current preview: the facts cache may
          // hold the previous text, and removals already invalidate, so a
          // write that changes facts must too.
          if (previous !== null) {
            rowFactsCache.delete(rowFactsCacheKey(conversationId, row));
          }
          const record: StoredRow = {
            // A message's creator and creation time are facts of the message,
            // not of the text currently indexed, so a rewrite keeps them. The
            // preview is text, so it follows the rewrite.
            createdAt: previous?.createdAt ?? entry.createdAt,
            messageId,
            present: true,
            preview: entry.preview,
            senderId: previous?.senderId ?? entry.senderId,
            tokenIds,
            version: SEARCH_INDEX_FORMAT_VERSION,
          };
          await requestAsPromise(
            rowsStore.put(record, rowKey(conversationId, row))
          );
        }
        // oxlint-enable no-await-in-loop

        // A batch that only re-indexed tombstones wrote no rows and allocated
        // no ids, so it must not write a header either.
        if (mutations.length === 0) {
          return;
        }
        // One get and one put per DISTINCT token the batch touched, instead of
        // one pair per (row x token). See planTokenListUpdates.
        const plans = planTokenListUpdates(mutations);
        // oxlint-disable no-await-in-loop -- sequential point reads and writes; Promise.all cannot batch requests issued on one transaction
        for (const [tokenId, update] of plans) {
          const key = postingKeyForId(conversationId, tokenId);
          const list = searchIndexRowListFrom(
            postingListFrom(
              await requestAsPromise<unknown>(postingsStore.get(key))
            )
          );
          // Drops before adds, so a row that both leaves and rejoins the same
          // token in one batch ends up a member.
          if (update.drop.length > 0) {
            rowListRemoveMany(list, new Set(update.drop));
          }
          for (const mutation of mutations) {
            if (update.add.includes(mutation.row)) {
              rowListAdd(list, mutation.row, mutation.createdAt);
            }
          }
          await writePostingList(postingsStore, key, rowListToArrays(list));
        }
        // oxlint-enable no-await-in-loop
        if (allocatorMoved || dictionaryGrew) {
          await requestAsPromise(
            tx
              .objectStore(HEADER_STORE)
              .put(
                { dictionary, nextRow, version: SEARCH_INDEX_FORMAT_VERSION },
                conversationId
              )
          );
        }
      }
    );
  }

  // How many entries one write transaction covers.
  //
  // A whole backfill page used to be one transaction, and that is a lock held
  // for seconds: ~500 rows x ~10 tokens is thousands of requests, each rewriting
  // a posting list, and IndexedDB serialises a readwrite transaction against
  // every read of the same stores. The cost was a search page turn that sat on
  // "loading" for tens of seconds while a walk ran behind it, because its read
  // could not even start. Chunks keep each commit short so reads interleave with
  // the walk.
  //
  // Idempotence is what makes the split safe: rows are keyed by their own
  // interned id, so re-putting a committed entry rewrites the same row and the
  // same posting members, and a chunk that fails after an earlier one committed
  // is re-sent by the caller's retry. The walk is resumable, so partial coverage
  // costs a redundant pass, never correctness.
  const PUT_CHUNK_ENTRIES = 64;

  return {
    clearConversation(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve();
      }
      dropCachedConversation(conversationId);
      return runTransaction(SEARCH_STORES, "readwrite", async (tx) => {
        // A handful of sequential range deletes: Promise.all cannot be used
        // because requests issued on a transaction outside its callback's
        // lifetime are rejected, and these are all issued here.
        // oxlint-disable no-await-in-loop
        for (const name of SEARCH_STORES) {
          // Each store is cleared with the bound ITS key shape needs. The two are
          // not interchangeable: an IndexedDB key is an ordered array, and a
          // two-part bound does not contain three-part keys, so reusing the text
          // index's range over the refs stores would clear nothing and leave a
          // conversation's media behind after eviction.
          if (name === REFS_STORE) {
            await requestAsPromise(
              tx.objectStore(name).delete(refsKeyRange(conversationId))
            );
            continue;
          }
          const store = tx.objectStore(name);
          const keyedByConversationAlone =
            name === HEADER_STORE ||
            name === META_STORE ||
            name === PENDING_STORE ||
            name === REFS_COUNTS_STORE;
          await requestAsPromise(
            keyedByConversationAlone
              ? store.delete(conversationId)
              : store.delete(conversationKeyRange(conversationId))
          );
        }
        // oxlint-enable no-await-in-loop
      });
    },

    countPending(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(0);
      }
      return runTransaction(
        [META_STORE, PENDING_STORE, PENDING_QUEUE_STORE],
        "readwrite",
        async (tx) => {
          await migrateLegacyPendingQueue(tx, conversationId);
          return requestAsPromise(
            tx
              .objectStore(PENDING_QUEUE_STORE)
              .count(pendingQueueRange(conversationId))
          );
        }
      );
    },

    hasIndexedMessages(conversationId, messageIds) {
      if (storageUnavailable() || messageIds.length === 0) {
        return Promise.resolve(new Set<string>());
      }
      // One readonly transaction for the whole page: a few hundred point
      // reads that never touch the postings. The forward map keeps tombstones
      // alongside live rows, so presence there means covered either way -- but
      // the row record itself is shape-checked, because a row written before
      // previews existed must NOT count: skipping it would strand the page on
      // rows the list cannot render and the read path treats as absent.
      return runTransaction(
        [ROW_IDS_STORE, ROWS_STORE],
        "readonly",
        async (tx) => {
          const rowIdsStore = tx.objectStore(ROW_IDS_STORE);
          const rowsStore = tx.objectStore(ROWS_STORE);
          const out = new Set<string>();
          // oxlint-disable no-await-in-loop -- sequential point reads on one transaction; Promise.all would issue requests outside its lifetime
          for (const messageId of messageIds) {
            const row = await requestAsPromise<number | undefined>(
              rowIdsStore.get(rowIdKey(conversationId, messageId))
            );
            if (row === undefined) {
              continue;
            }
            const stored = await requestAsPromise<unknown>(
              rowsStore.get(rowKey(conversationId, row))
            );
            if (isStoredRow(stored)) {
              out.add(messageId);
            }
          }
          // oxlint-enable no-await-in-loop
          return out;
        }
      );
    },

    hasPendingMessages(conversationId, messageIds) {
      if (storageUnavailable() || messageIds.length === 0) {
        return Promise.resolve(new Set<string>());
      }
      return runTransaction(
        [META_STORE, PENDING_STORE, PENDING_QUEUE_STORE],
        "readwrite",
        async (tx) => {
          await migrateLegacyPendingQueue(tx, conversationId);
          const store = tx.objectStore(PENDING_QUEUE_STORE);
          const pending = new Set<string>();
          // oxlint-disable no-await-in-loop -- page-limited point reads share one transaction
          for (const messageId of new Set(messageIds)) {
            const value = await requestAsPromise<unknown>(
              store.get([conversationId, messageId])
            );
            if (value === messageId) {
              pending.add(messageId);
            }
          }
          // oxlint-enable no-await-in-loop
          return pending;
        }
      );
    },

    // A cursor over the meta store, which holds one small record per conversation.
    // Deliberately not a scan of rows or postings: eviction must be cheap enough
    // to run on every conversation open.
    listConversations() {
      if (storageUnavailable()) {
        return Promise.resolve([]);
      }
      return runTransaction(
        [META_STORE, HEADER_STORE],
        "readonly",
        async (tx) => {
          const out: SearchIndexConversationSummary[] = [];
          await drainCursor(
            tx.objectStore(META_STORE).openCursor(),
            (key, value) => {
              // The meta store is keyed by conversationId alone, unlike the
              // [conversationId, ...] stores walked elsewhere.
              if (
                !isConversationKey(key) ||
                !isStoredMeta(value) ||
                value.conversationId !== key
              ) {
                return;
              }
              out.push({
                conversationId: value.conversationId,
                indexedRowCount: 0,
                lastAccessedAt: value.lastAccessedAt,
              });
            }
          );
          // Row counts come from the header's allocator, one point read each.
          // Small and bounded by conversation count, unlike walking every row.
          // Sequential because they share this transaction.
          // oxlint-disable no-await-in-loop -- point reads sharing one transaction
          for (const summary of out) {
            const read = await readHeader(tx, summary.conversationId);
            summary.indexedRowCount =
              read.kind === "usable" ? read.header.nextRow : 0;
          }
          // oxlint-enable no-await-in-loop
          return out;
        }
      );
    },

    // The hot write, chunked. See PUT_CHUNK_ENTRIES for why a whole page is not
    // one transaction.
    putEntries(conversationId, entries) {
      if (storageUnavailable() || entries.size === 0) {
        return Promise.resolve();
      }
      if (entries.size <= PUT_CHUNK_ENTRIES) {
        return putEntryChunk(conversationId, entries);
      }
      return (async () => {
        // oxlint-disable no-await-in-loop -- chunks must commit in order, or the
        // later ones would be indexed against a header the earlier ones have not
        // written yet
        let chunk = new Map<string, SearchIndexEntry>();
        for (const [messageId, entry] of entries) {
          chunk.set(messageId, entry);
          if (chunk.size >= PUT_CHUNK_ENTRIES) {
            await putEntryChunk(conversationId, chunk);
            chunk = new Map<string, SearchIndexEntry>();
          }
        }
        if (chunk.size > 0) {
          await putEntryChunk(conversationId, chunk);
        }
        // oxlint-enable no-await-in-loop
      })();
    },

    putSharedRefs(conversationId, rows) {
      if (storageUnavailable() || rows.size === 0) {
        return Promise.resolve();
      }
      return runTransaction(
        [REFS_STORE, REFS_MESSAGE_STORE, REFS_COUNTS_STORE],
        "readwrite",
        async (tx) => {
          const refStore = tx.objectStore(REFS_STORE);
          const forwardStore = tx.objectStore(REFS_MESSAGE_STORE);
          const countsStore = tx.objectStore(REFS_COUNTS_STORE);

          const stored = await requestAsPromise<unknown>(
            countsStore.get(conversationId)
          );
          const counts: SharedRefsCounts = isStoredRefsCounts(stored)
            ? { ...stored }
            : emptySharedRefsCounts(conversationId);

          // oxlint-disable no-await-in-loop -- one readwrite transaction; requests
          // issued on a transaction outside its callback's lifetime are rejected, so
          // these must be issued here and awaited in order
          for (const [messageId, write] of rows) {
            // Old refs go first. Leaving them behind would show the user two
            // things at once: the URL a message used to carry and the one it
            // carries now, neither of which is a message they can read.
            await deleteRefKeys(
              refStore,
              forwardStore,
              counts,
              conversationId,
              messageId
            );

            const { records } = buildSharedRefRecords({
              createdAt: write.createdAt,
              messageId,
              refs: write.refs,
              senderId: write.senderId,
            } as SharedRefsWriteRow);
            if (records.length === 0) {
              // Refs went away entirely (an edit that stripped them). No forward
              // entry, because "no refs stored" IS the state to resume from.
              continue;
            }

            const keys: string[] = [];
            for (const record of records) {
              const kind = refKindOf(record);
              const timeKey = sharedRefTimeKey(
                record.createdAt,
                record.messageId,
                record.index
              );
              await requestAsPromise(
                refStore.put(
                  { ...record, version: SHARED_REFS_FORMAT_VERSION },
                  [conversationId, kind, timeKey]
                )
              );
              counts[kind] += 1;
              keys.push(`${kind}\u0000${timeKey}`);
            }
            await requestAsPromise(
              forwardStore.put({ keys, version: SHARED_REFS_FORMAT_VERSION }, [
                conversationId,
                messageId,
              ])
            );
          }

          await requestAsPromise(
            countsStore.put(
              { ...counts, version: SHARED_REFS_FORMAT_VERSION },
              conversationId
            )
          );
        }
      );
    },
    query(conversationId, tokens, limit, options) {
      if (
        storageUnavailable() ||
        (tokens.length === 0 && options?.prefix === undefined)
      ) {
        return Promise.resolve(emptyQueryResult());
      }
      return (async () => {
        // Header and posting lists in one readonly transaction: the header is a
        // single point read, and an unknown token returns before a single posting
        // is touched.
        const intersection = await runTransaction(
          [HEADER_STORE, POSTINGS_STORE],
          "readonly",
          async (tx) => {
            const read = await readHeader(tx, conversationId);
            if (read.kind !== "usable") {
              return { hasMore: false, totalMatched: 0, windowRows: [] };
            }
            const { header } = read;
            const tokenIdByText = new Map(
              header.dictionary.map((token, tokenId) => [token, tokenId])
            );
            // Every token must be known. The words are ANDed, so one word the
            // index has never seen means the message cannot contain all of them:
            // dropping the unknown word instead would turn `deploy zzz` into
            // `deploy` and return a false positive, which is the worst possible
            // failure for a search box.
            const wanted: number[] = [];
            for (const token of tokens) {
              const tokenId = tokenIdByText.get(token);
              if (tokenId === undefined) {
                return { hasMore: false, totalMatched: 0, windowRows: [] };
              }
              wanted.push(tokenId);
            }
            const postingsStore = tx.objectStore(POSTINGS_STORE);
            const lists: SearchIndexPostingList[] = [];
            // oxlint-disable no-await-in-loop -- sequential point reads on one transaction; Promise.all would issue requests outside its lifetime
            for (const tokenId of wanted) {
              lists.push(
                postingListFrom(
                  await requestAsPromise<unknown>(
                    postingsStore.get(postingKeyForId(conversationId, tokenId))
                  )
                )
              );
            }
            const prefix = options?.prefix;
            if (prefix !== undefined) {
              const expansions = expandPrefixTerm(header.dictionary, prefix);
              if (expansions.length === 0) {
                return { hasMore: false, totalMatched: 0, windowRows: [] };
              }
              const expansionLists: SearchIndexPostingList[] = [];
              for (const term of expansions) {
                // Came from the dictionary just read, so the id exists; the
                // posting itself may still be absent for a term added but never
                // written, which reads as empty.
                const tokenId = tokenIdByText.get(term) ?? -1;
                expansionLists.push(
                  tokenId < 0
                    ? EMPTY_POSTING_LIST
                    : postingListFrom(
                        await requestAsPromise<unknown>(
                          postingsStore.get(
                            postingKeyForId(conversationId, tokenId)
                          )
                        )
                      )
                );
              }
              lists.push(unionPostingLists(expansionLists));
            }
            // oxlint-enable no-await-in-loop
            // Intersect and choose only the requested newest window. Both the
            // exact total and the bounded result page come from this one
            // transaction snapshot, without allocating or sorting every match.
            const { hasMore, totalMatched, window } =
              intersectPostingListsWindow(lists, limit, options?.afterMatch);
            return {
              hasMore,
              totalMatched,
              windowRows: window.map((match) => match.row),
            };
          }
        );
        if (intersection.windowRows.length === 0) {
          // The count is the FULL intersection, and it survives an empty page of
          // resolved rows: the result bar renders "n of N" from it.
          return {
            hasMore: intersection.hasMore,
            rows: new Map<number, SearchIndexRowFacts>(),
            totalMatched: intersection.totalMatched,
          };
        }
        // A second transaction, so up to `limit` row reads never share a
        // transaction with the posting reads. A row deleted between the two is
        // simply absent from `rows`: it was already on its way out, and the
        // matched rows' own facts cannot change.
        const rows = await resolveRowFacts(
          conversationId,
          intersection.windowRows
        );
        return {
          hasMore: intersection.hasMore,
          rows,
          totalMatched: intersection.totalMatched,
        };
      })();
    },

    // Bulk read for deliberate structural tests and whole-index accounting,
    // never the keystroke path. Keyed by token TEXT, resolved back through the
    // header's dictionary. Emptied lists are omitted.
    readAllPostingLists(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(new Map<string, Uint32Array>());
      }
      return runTransaction(
        [HEADER_STORE, POSTINGS_STORE],
        "readonly",
        async (tx) => {
          const read = await readHeader(tx, conversationId);
          if (read.kind !== "usable") {
            return new Map<string, Uint32Array>();
          }
          const { header } = read;
          const postingsStore = tx.objectStore(POSTINGS_STORE);
          const out = new Map<string, Uint32Array>();
          // oxlint-disable no-await-in-loop -- sequential point reads on one transaction
          for (const [tokenId, token] of header.dictionary.entries()) {
            const list = postingListFrom(
              await requestAsPromise<unknown>(
                postingsStore.get(postingKeyForId(conversationId, tokenId))
              )
            );
            if (list.rows.length > 0) {
              out.set(token, list.rows);
            }
          }
          // oxlint-enable no-await-in-loop
          return out;
        }
      );
    },

    readMeta(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(null);
      }
      return runTransaction(
        [META_STORE, PENDING_STORE, PENDING_QUEUE_STORE],
        "readwrite",
        async (tx) => {
          await migrateLegacyPendingQueue(tx, conversationId);
          const value = await requestAsPromise<unknown>(
            tx.objectStore(META_STORE).get(conversationId)
          );
          if (
            !isStoredMeta(value) ||
            value.conversationId !== conversationId ||
            !Array.isArray(value.pendingIds)
          ) {
            return null;
          }
          // A copy, so a caller mutating the result cannot corrupt what is stored.
          return { ...value, pendingIds: [...value.pendingIds] };
        }
      );
    },

    readPendingPage(conversationId, options) {
      if (storageUnavailable()) {
        return Promise.resolve([]);
      }
      return runTransaction(
        [META_STORE, PENDING_STORE, PENDING_QUEUE_STORE],
        "readwrite",
        async (tx) => {
          await migrateLegacyPendingQueue(tx, conversationId);
          return readPendingQueuePage(tx, conversationId, options);
        }
      );
    },

    readRows(conversationId, rowIds) {
      if (storageUnavailable()) {
        return Promise.resolve(new Map());
      }
      return resolveRowFacts(conversationId, rowIds);
    },

    // One point read of the allocator's high-water mark. No scan, so this stays
    // cheap enough to run for a coverage label on every open.
    readSharedRefs(conversationId, kind, options) {
      if (storageUnavailable()) {
        return Promise.resolve(emptyRefsPage());
      }
      const limit = Math.max(1, options?.limit ?? 50);
      const { lower, upper } = sharedRefRange(
        conversationId,
        kind,
        options?.after
      );
      return runTransaction([REFS_STORE], "readonly", async (tx) => {
        const store = tx.objectStore(REFS_STORE);
        // `prev` rather than `next`: IndexedDB walks a range in ascending key
        // order, and this read is newest-first, so the cursor runs backwards. The
        // key order IS the time order, which is the whole reason the key carries
        // the kind and a padded timestamp.
        //
        // BOTH bounds open. A closed lower bound would include the cursor's own
        // row, so every page turn repeated the boundary message — a 10-row
        // conversation read as 12 rows across three pages, with two duplicates.
        const range = IDBKeyRange.bound(lower, upper, true, true);
        const items: SharedRefRecord[] = [];
        let lastTimeKey: string | undefined;
        let hasMore = false;
        // A cursor has no promise-based form, so the read is written against its
        // events. oxlint-disable: IDB cursor lifecycle is event-based, and the
        // alternative (a get per row) turns one range read into O(page) requests.
        // oxlint-disable-next-line promise/avoid-new, no-await-in-loop
        await new Promise<void>((resolve, reject) => {
          const request = store.openCursor(range, "prev");
          request.addEventListener("success", () => {
            const cursor = request.result;
            if (!cursor || items.length >= limit) {
              if (cursor && items.length >= limit) {
                // One record past the page, so `hasMore` is a fact about the
                // store rather than an inference from the page size, and a caller
                // never renders a "load more" that would find nothing.
                hasMore = true;
              }
              resolve();
              return;
            }
            const { key, value } = cursor;
            // The third key component is the sort key; the first two are the
            // conversation and the kind, both already fixed by the range.
            const timeKey = Array.isArray(key) ? key[2] : undefined;
            if (isStoredRef(value) && isSharedRefTimeKey(timeKey)) {
              items.push(value);
              lastTimeKey = timeKey;
            }
            cursor.continue();
          });
          request.addEventListener("error", () => {
            reject(request.error ?? new Error("idb cursor"));
          });
        });
        const page: SharedRefsPage = {
          hasMore,
          items,
        };
        if (hasMore && lastTimeKey !== undefined) {
          page.after = lastTimeKey;
        }
        return page;
      });
    },
    readSharedRefsCounts(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(null);
      }
      return runTransaction([REFS_COUNTS_STORE], "readonly", async (tx) => {
        const stored = await requestAsPromise<unknown>(
          tx.objectStore(REFS_COUNTS_STORE).get(conversationId)
        );
        // A record from another version reads as "nothing stored", which for a
        // label is the same as zero, and the next write rebuilds it.
        return isStoredRefsCounts(stored) ? { ...stored } : null;
      });
    },
    readStats(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve({ indexedRowCount: 0 });
      }
      return runTransaction([HEADER_STORE], "readonly", async (tx) => {
        const read = await readHeader(tx, conversationId);
        return {
          indexedRowCount: read.kind === "usable" ? read.header.nextRow : 0,
        };
      });
    },

    // One readwrite transaction, and a tombstone rather than a delete. The row
    // record and its `row-ids` entry both stay, so the id is never handed out
    // again and a stale device cannot resurrect the deletion; only the row's own
    // tokens leave the posting lists, so the cost is bounded by the messages
    // removed rather than by the conversation's vocabulary.
    removeEntries(conversationId, messageIds) {
      if (storageUnavailable() || messageIds.length === 0) {
        return Promise.resolve();
      }
      return runTransaction(
        [ROWS_STORE, ROW_IDS_STORE, POSTINGS_STORE],
        "readwrite",
        async (tx) => {
          const rowsStore = tx.objectStore(ROWS_STORE);
          const rowIdsStore = tx.objectStore(ROW_IDS_STORE);
          const postingsStore = tx.objectStore(POSTINGS_STORE);
          const removedRows: number[] = [];
          // Collected BEFORE the rows are tombstoned, which empties their token
          // lists. Only these tokens' posting lists can contain the removed rows,
          // so the whole dictionary is never walked.
          const affectedTokenIds = new Set<number>();
          // oxlint-disable no-await-in-loop -- sequential point reads and writes on one transaction
          for (const messageId of messageIds) {
            const row = await requestAsPromise<number | undefined>(
              rowIdsStore.get(rowIdKey(conversationId, messageId))
            );
            if (row === undefined) {
              continue;
            }
            const stored = await requestAsPromise<unknown>(
              rowsStore.get(rowKey(conversationId, row))
            );
            if (!isStoredRow(stored) || !stored.present) {
              continue;
            }
            for (const tokenId of stored.tokenIds) {
              affectedTokenIds.add(tokenId);
            }
            removedRows.push(row);
            // The tombstone keeps its facts in storage but must never resolve
            // as a match again: drop the cached facts so the next read sees
            // the tombstone rather than the row as it was.
            rowFactsCache.delete(rowFactsCacheKey(conversationId, row));
            await requestAsPromise(
              rowsStore.put(
                { ...stored, present: false, tokenIds: [] },
                rowKey(conversationId, row)
              )
            );
          }
          if (removedRows.length === 0) {
            return;
          }
          const rowsToRemove = new Set(removedRows);
          for (const tokenId of affectedTokenIds) {
            const key = postingKeyForId(conversationId, tokenId);
            const existing = postingListFrom(
              await requestAsPromise<unknown>(postingsStore.get(key))
            );
            if (existing.rows.length === 0) {
              continue;
            }
            const list = searchIndexRowListFrom(existing);
            rowListRemoveMany(list, rowsToRemove);
            await writePostingList(postingsStore, key, rowListToArrays(list));
          }
          // oxlint-enable no-await-in-loop
        }
      );
    },

    removeSharedRefs(conversationId, messageIds) {
      if (storageUnavailable() || messageIds.length === 0) {
        return Promise.resolve();
      }
      return runTransaction(
        [REFS_STORE, REFS_MESSAGE_STORE, REFS_COUNTS_STORE],
        "readwrite",
        async (tx) => {
          const refStore = tx.objectStore(REFS_STORE);
          const forwardStore = tx.objectStore(REFS_MESSAGE_STORE);
          const countsStore = tx.objectStore(REFS_COUNTS_STORE);
          const stored = await requestAsPromise<unknown>(
            countsStore.get(conversationId)
          );
          const counts: SharedRefsCounts = isStoredRefsCounts(stored)
            ? { ...stored }
            : emptySharedRefsCounts(conversationId);

          for (const messageId of messageIds) {
            // oxlint-disable-next-line no-await-in-loop -- one transaction, order is irrelevant
            await deleteRefKeys(
              refStore,
              forwardStore,
              counts,
              conversationId,
              messageId
            );
          }
          await requestAsPromise(
            countsStore.put(
              { ...counts, version: SHARED_REFS_FORMAT_VERSION },
              conversationId
            )
          );
        }
      );
    },

    async updatePending(conversationId, changes) {
      if (storageUnavailable()) {
        return 0;
      }
      const removedIds = [...new Set(changes.remove)];
      const removed = new Set(removedIds);
      const addedIds = [...new Set(changes.add)].filter(
        (messageId) => !removed.has(messageId)
      );
      const operations: { kind: "add" | "remove"; messageId: string }[] = [
        ...removedIds.map((messageId) => ({
          kind: "remove" as const,
          messageId,
        })),
        ...addedIds.map((messageId) => ({ kind: "add" as const, messageId })),
      ];
      if (operations.length === 0) {
        return runTransaction(
          [META_STORE, PENDING_STORE, PENDING_QUEUE_STORE],
          "readwrite",
          async (tx) => {
            await migrateLegacyPendingQueue(tx, conversationId);
            return requestAsPromise(
              tx
                .objectStore(PENDING_QUEUE_STORE)
                .count(pendingQueueRange(conversationId))
            );
          }
        );
      }
      let count = 0;
      // Transactions stay short so a large retry update cannot block search reads.
      // oxlint-disable no-await-in-loop
      for (let offset = 0; offset < operations.length; offset += 128) {
        const batch = operations.slice(offset, offset + 128);
        count = await runTransaction(
          [META_STORE, PENDING_STORE, PENDING_QUEUE_STORE],
          "readwrite",
          async (tx) => {
            await migrateLegacyPendingQueue(tx, conversationId);
            const store = tx.objectStore(PENDING_QUEUE_STORE);
            for (const operation of batch) {
              if (operation.kind === "remove") {
                // oxlint-disable-next-line no-await-in-loop
                await requestAsPromise<undefined>(
                  store.delete([conversationId, operation.messageId])
                );
              }
              if (operation.kind === "add") {
                // oxlint-disable-next-line no-await-in-loop
                await requestAsPromise<IDBValidKey>(
                  store.put(operation.messageId, [
                    conversationId,
                    operation.messageId,
                  ])
                );
              }
            }
            return requestAsPromise(
              store.count(pendingQueueRange(conversationId))
            );
          }
        );
      }
      // oxlint-enable no-await-in-loop
      return count;
    },

    writeMeta(meta) {
      if (storageUnavailable()) {
        return Promise.resolve();
      }
      return runTransaction([META_STORE], "readwrite", async (tx) => {
        await requestAsPromise(
          tx.objectStore(META_STORE).put(
            {
              ...meta,
              pendingIds: [...meta.pendingIds],
              version: SEARCH_INDEX_FORMAT_VERSION,
            },
            meta.conversationId
          )
        );
      });
    },

    // ---- shared-content refs ----
  };
}

function emptyRefsPage(): SharedRefsPage {
  return { hasMore: false, items: [] };
}

// Test seam: closes the cached connection and deletes the database, so a test
// starts from a genuinely empty store. The close has to happen first: an open
// connection blocks deleteDatabase, and the delete would then hang rather than
// fail.
//
// Bounded: more than a couple of attempts means a connection that is never
// closing, which a retry loop should not paper over by spinning.

export async function resetIndexedDbSearchIndexStoreForTests(): Promise<void> {
  const open = dbPromise;
  dbPromise = null;
  // Cleared alongside the handle. A `true` left over from a previous delete would
  // make the next open discard a perfectly good connection and reopen, which is
  // harmless on its own but hides the real reason a test wanted a fresh one.
  staleConnection = false;
  if (open) {
    try {
      const db = await open;
      db.close();
    } catch {
      // Already closed or never opened.
    }
  }
  if (typeof indexedDB === "undefined") {
    return;
  }
  // oxlint-disable-next-line promise/avoid-new -- IndexedDB delete lifecycle is event-based
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(MESSAGES_DB_NAME);
    request.addEventListener("success", () => resolve());
    // A failure or a block still ends the wait: the next open recreates the
    // stores, which is all a test needs.
    request.addEventListener("error", () => resolve());
    request.addEventListener("blocked", () => {
      resolve();
    });
  });
}
