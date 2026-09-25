// IndexedDB backend for the local message search index.
//
// Thin by design: every rule about what an index means lives in
// search-index-format.ts (pure, tested) and in the store contract, so the
// browser backend cannot drift from the tested in-memory reference.
//
// Schema, and why it is shaped this way:
//
//   rows      [conversationId, row]      -> { messageId, createdAt, senderId, tokens }
//   row-ids   [conversationId, messageId] -> row
//   postings  [conversationId, token]     -> Uint32Array of row ids
//   alloc     conversationId              -> next row id to hand out
//   meta      conversationId              -> coverage cursor
//
// Two decisions carry the performance:
//
// - Rows are keyed by ROW ID, not by message id. A query intersects posting lists
//   to get row ids and then resolves exactly those rows, so answering a search
//   costs O(results) instead of O(conversation). Keying by message id is what
//   previously forced a full scan of every row on each search, which held 76MB in
//   memory for a 200k-message conversation. The write path still needs to go from
//   a message id to its row, which is all `row-ids` is for.
// - Postings are keyed by token, so a query is one point read per typed word.
//   Loading every posting list cost ~146MB of RAM on 200k messages.
//
// Message ids are stored once, in `rows`. Postings hold small integers, which is
// what keeps the index smaller than the messages it indexes.
//
// NOT YET SEALED: the row table is plaintext at rest, so `messageId -> tokens` is
// a confirmation oracle for anyone holding the device database. The primitives to
// close that are built and tested (see search-index-vault.ts and the index key
// derivation in crypto.ts): an AES-GCM seal plus a compact row-table codec, keyed
// by HKDF(root, "asm:index:<conversationId>") so the key is a sibling of the
// ratchet and wrap keys and cannot weaken message recovery. What is missing is
// swapping this file's row storage for one sealed record per conversation, which
// re-seals the whole table per write batch. That is a focused change and is
// deliberately not landed half-finished.
//
// Fail-tolerant: a denied or corrupt database rejects, and every caller reads that
// as "not indexed" rather than letting it reach the transcript.

import {
  ensureMessagesSchema,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  SEARCH_ALLOC_STORE,
  SEARCH_META_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_ROW_IDS_STORE,
  SEARCH_ROWS_STORE,
} from "./message-db";
import {
  emptySearchIndexRowList,
  rowListAdd,
  rowListRemove,
  rowListRemoveMany,
  rowListToArray,
  searchIndexRowListFrom,
  SEARCH_INDEX_FORMAT_VERSION,
} from "./search-index-format";
import type {
  SearchIndexConversationSummary,
  SearchIndexMeta,
  SearchIndexRowList,
  SearchIndexRowLookup,
  SearchIndexStore,
} from "./search-index-format";

// Name and version are shared with the identity key store, which opens the same
// database. See message-db.ts: disagreeing versions throw VersionError, and the
// identity store is what makes a DM decryptable at all.
// v1 is the private-key store from crypto.ts. v2 was a superseded search shape.
// v3 interned row ids but still keyed rows by message id. v4 split the row
// allocator out of meta. v5 re-keys rows by row id, which is what lets a query
// resolve only its own matches.
//
// The v3/v4 row store is reset rather than migrated: its records are keyed by
// message id, and reading one under the new key would hand back a message id
// where a row id is expected. A mixture is worse than an empty index, and the
// index is rebuildable by walking history, so the honest move on upgrade is to
// drop it and re-index.
const ROWS_STORE = SEARCH_ROWS_STORE;
const ROW_IDS_STORE = SEARCH_ROW_IDS_STORE;
const POSTINGS_STORE = SEARCH_POSTINGS_STORE;
// The row-id allocator, kept out of `search-meta` on purpose: the backfill walk
// rewrites meta on every page, and sharing one object with the write path would
// let the two roll each other's state back. See SearchIndexMeta.
const ALLOC_STORE = SEARCH_ALLOC_STORE;
const META_STORE = SEARCH_META_STORE;
const SEARCH_STORES = [
  ROWS_STORE,
  ROW_IDS_STORE,
  POSTINGS_STORE,
  ALLOC_STORE,
  META_STORE,
];
// Versions whose search keying cannot be migrated, so their stores are dropped.
// Identity material is never in that set.
const RESET_BELOW_VERSION = 5;

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
    request.addEventListener("upgradeneeded", () => {
      // The shared schema builder, so the search stores exist even when the
      // identity store created this database first.
      ensureMessagesSchema(request.result, {
        resetSearchStoresBelow: RESET_BELOW_VERSION,
        version: MESSAGES_DB_VERSION,
      });
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
async function runTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  // eslint-disable-next-line promise/avoid-new -- IndexedDB transaction lifecycle is event-based
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result: T;
    let settled = false;
    tx.addEventListener("complete", () => {
      if (!settled) {
        resolve(result);
      }
    });
    tx.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("idb transaction"));
      }
    });
    tx.addEventListener("abort", () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("idb transaction aborted"));
      }
    });
    void Promise.resolve(work(tx))
      .then((value) => {
        result = value;
      })
      .catch((error: unknown) => {
        settled = true;
        try {
          tx.abort();
        } catch {
          // Already aborting.
        }
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
// ones attached: step n fires n listeners, making the walk quadratic. Measured on
// a row-table read that was 585ms at 500 rows, 10.5s at 2,000, and 65s at 5,000 —
// a conversation-scale index could never have been opened. One self-reusing
// listener makes it linear. Kept for the whole-conversation operations (clearing,
// eviction accounting); the query path no longer needs it at all.
function drainCursor(
  request: ReturnType<IDBObjectStore["openCursor"]>,
  onRow: (key: [string, string] | string, value: unknown) => void
): Promise<void> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB cursor lifecycle is event-based
  return new Promise<void>((resolve, reject) => {
    request.addEventListener("success", () => {
      const cursor = request.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve();
        return;
      }
      onRow(cursor.key as [string, string] | string, cursor.value);
      // Reusing the same request is what makes this one listener enough.
      cursor.continue();
    });
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("idb cursor"))
    );
  });
}

// Stores a posting list, deleting the record when it empties. `put` and `delete`
// return differently-typed requests, which a union cannot express here, so both
// branches live in one place rather than at each call site. Deleting an emptied
// list keeps the store free of records that can never match again.
async function writePostingList(
  store: IDBObjectStore,
  key: [string, string],
  list: Uint32Array
): Promise<void> {
  if (list.length === 0) {
    await requestAsPromise(store.delete(key));
    return;
  }
  await requestAsPromise(store.put(list, key));
}

function postingKey(conversationId: string, token: string): [string, string] {
  return [conversationId, token];
}

function rowKey(conversationId: string, row: number): [string, string] {
  return [conversationId, row.toString()];
}

function rowIdKey(conversationId: string, messageId: string): [string, string] {
  return [conversationId, messageId];
}

// Range over a conversation's entries in a store keyed [conversationId, string].
function stringKeyRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    postingKey(conversationId, ""),
    postingKey(conversationId, "￿")
  );
}

// Range over a conversation's entries in the row store, whose second key is the
// row id rendered as a string.
function rowKeyRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    rowKey(conversationId, 0),
    rowKey(conversationId, Number.MAX_SAFE_INTEGER)
  );
}

interface StoredRow {
  createdAt: number;
  messageId: string;
  row: number;
  senderId: string;
  tokens: string[];
  version: number;
}

function isCurrentVersion(value: unknown): value is StoredRow {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as StoredRow).version === SEARCH_INDEX_FORMAT_VERSION
  );
}

async function readMetaFor(
  tx: IDBTransaction,
  conversationId: string
): Promise<SearchIndexMeta | null> {
  const stored = await requestAsPromise<SearchIndexMeta | undefined>(
    tx.objectStore(META_STORE).get(conversationId)
  );
  if (!stored || stored.version !== SEARCH_INDEX_FORMAT_VERSION) {
    return null;
  }
  return stored;
}

export function createIndexedDbSearchIndexStore(): SearchIndexStore {
  return {
    clearConversation(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve();
      }
      return runTransaction(SEARCH_STORES, "readwrite", async (tx) => {
        await requestAsPromise(
          tx.objectStore(ROWS_STORE).delete(rowKeyRange(conversationId))
        );
        await requestAsPromise(
          tx.objectStore(ROW_IDS_STORE).delete(stringKeyRange(conversationId))
        );
        await requestAsPromise(
          tx.objectStore(POSTINGS_STORE).delete(stringKeyRange(conversationId))
        );
        await requestAsPromise(
          tx.objectStore(META_STORE).delete(conversationId)
        );
        // Dropped with everything else: a stale allocator would skip row ids
        // and leave gaps in the posting lists, which is harmless but wasteful.
        await requestAsPromise(
          tx.objectStore(ALLOC_STORE).delete(conversationId)
        );
      });
    },

    // A cursor over the meta store, which holds one small record per conversation.
    // Deliberately not a scan of rows or postings: eviction must be cheap enough
    // to run on every conversation open.
    listConversations() {
      if (storageUnavailable()) {
        return Promise.resolve([]);
      }
      return runTransaction(
        [META_STORE, ALLOC_STORE],
        "readonly",
        async (tx) => {
          const allocStore = tx.objectStore(ALLOC_STORE);
          const out: SearchIndexConversationSummary[] = [];
          await drainCursor(
            tx.objectStore(META_STORE).openCursor(),
            (key, value) => {
              const meta = value as SearchIndexMeta | undefined;
              // The meta store is keyed by conversationId alone, unlike the
              // [conversationId, ...] stores walked elsewhere.
              const conversationId = Array.isArray(key) ? key[0] : key;
              if (!meta || meta.conversationId !== conversationId) {
                return;
              }
              out.push({
                conversationId,
                indexedRowCount: 0,
                lastAccessedAt: meta.lastAccessedAt ?? 0,
              });
            }
          );
          // Row counts come from the allocator, one point read each. Small and
          // bounded by conversation count, unlike walking every row. Sequential
          // because they share this transaction.
          // oxlint-disable no-await-in-loop -- point reads sharing one transaction
          for (const summary of out) {
            const count = await requestAsPromise<number | undefined>(
              allocStore.get(summary.conversationId)
            );
            summary.indexedRowCount = count ?? 0;
          }
          // oxlint-enable no-await-in-loop
          return out;
        }
      );
    },

    putEntries(conversationId, entries) {
      if (storageUnavailable() || entries.size === 0) {
        return Promise.resolve();
      }
      return runTransaction(
        [ROWS_STORE, ROW_IDS_STORE, POSTINGS_STORE, ALLOC_STORE],
        "readwrite",
        async (tx) => {
          const rowsStore = tx.objectStore(ROWS_STORE);
          const rowIdsStore = tx.objectStore(ROW_IDS_STORE);
          const postingsStore = tx.objectStore(POSTINGS_STORE);
          let nextRow =
            (await requestAsPromise<number | undefined>(
              tx.objectStore(ALLOC_STORE).get(conversationId)
            )) ?? 0;

          // Posting lists are read once per token and written once per token,
          // not once per message. Indexing a 200k-message conversation one
          // message at a time would rewrite a common token's 80k-row list 80k
          // times, which is the difference between seconds and minutes.
          const dirty = new Map<string, SearchIndexRowList>();
          const listFor = async (token: string) => {
            const existing = dirty.get(token);
            if (existing) {
              return existing;
            }
            const stored = await requestAsPromise<Uint32Array | undefined>(
              postingsStore.get(postingKey(conversationId, token))
            );
            const list = stored
              ? searchIndexRowListFrom(stored)
              : emptySearchIndexRowList();
            dirty.set(token, list);
            return list;
          };

          // Sequential on purpose: each entry's row id and prior tokens must be
          // known before its posting lists are updated, and the whole batch is one
          // transaction so the work is atomic rather than concurrent.
          // oxlint-disable no-await-in-loop -- one entry at a time inside one transaction
          for (const [messageId, entry] of entries) {
            const idKey = rowIdKey(conversationId, messageId);
            const existingRow = await requestAsPromise<number | undefined>(
              rowIdsStore.get(idKey)
            );
            const row = existingRow ?? nextRow;
            if (existingRow === undefined) {
              nextRow += 1;
            }
            // The stored row carries its own tokens, which is the reverse index
            // that makes a rewrite touch only the lists it actually changed.
            const previous = await requestAsPromise<unknown>(
              rowsStore.get(rowKey(conversationId, row))
            );
            const { tokens: oldTokens } = isCurrentVersion(previous)
              ? previous
              : { tokens: [] as string[] };

            for (const token of oldTokens) {
              if (!entry.tokens.includes(token)) {
                rowListRemove(await listFor(token), row);
              }
            }
            for (const token of entry.tokens) {
              rowListAdd(await listFor(token), row);
            }

            const stored: StoredRow = {
              createdAt: entry.createdAt,
              messageId,
              row,
              senderId: entry.senderId,
              tokens: entry.tokens,
              version: SEARCH_INDEX_FORMAT_VERSION,
            };
            await requestAsPromise(
              rowsStore.put(stored, rowKey(conversationId, row))
            );
            await requestAsPromise(rowIdsStore.put(row, idKey));
          }

          for (const [token, list] of dirty) {
            await writePostingList(
              postingsStore,
              postingKey(conversationId, token),
              rowListToArray(list)
            );
          }

          // Same transaction as the rows and postings it allocates for, so the
          // allocator can never advance past rows that were not committed.
          await requestAsPromise(
            tx.objectStore(ALLOC_STORE).put(nextRow, conversationId)
          );
        }
      );
    },

    readAllPostingLists(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(new Map<string, Uint32Array>());
      }
      return runTransaction([POSTINGS_STORE], "readonly", async (tx) => {
        const out = new Map<string, Uint32Array>();
        await drainCursor(
          tx
            .objectStore(POSTINGS_STORE)
            .openCursor(stringKeyRange(conversationId)),
          (key, value) => {
            out.set(key[1], value as Uint32Array);
          }
        );
        return out;
      });
    },

    readMeta(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(null);
      }
      return runTransaction([META_STORE], "readonly", (tx) =>
        readMetaFor(tx, conversationId)
      );
    },

    // The hot query read: one point lookup per typed word, not a scan.
    readPostingList(conversationId, token) {
      if (storageUnavailable()) {
        return Promise.resolve(new Uint32Array(0));
      }
      return runTransaction([POSTINGS_STORE], "readonly", async (tx) => {
        const list = await requestAsPromise<Uint32Array | undefined>(
          tx.objectStore(POSTINGS_STORE).get(postingKey(conversationId, token))
        );
        return list ?? new Uint32Array(0);
      });
    },

    // Resolves exactly the rows a query matched. One point read per result, so
    // search memory is bounded by the result cap rather than by the
    // conversation, and no cursor is involved at all.
    readRows(conversationId, rowIds) {
      if (storageUnavailable() || rowIds.length === 0) {
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
          if (isCurrentVersion(stored)) {
            out.set(row, {
              createdAt: stored.createdAt,
              messageId: stored.messageId,
              senderId: stored.senderId,
            });
          }
        }
        return out;
      });
    },

    readStats(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve({ indexedRowCount: 0 });
      }
      return runTransaction([ALLOC_STORE], "readonly", async (tx) => {
        const next = await requestAsPromise<number | undefined>(
          tx.objectStore(ALLOC_STORE).get(conversationId)
        );
        return { indexedRowCount: next ?? 0 };
      });
    },

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
          // Resolve rows first: deleting them would lose the only record of
          // which posting lists to clean. Each list is then read and written once
          // for the whole batch, not once per removed message.
          const rowsByToken = new Map<string, number[]>();
          let removedAny = false;
          for (const messageId of messageIds) {
            const idKey = rowIdKey(conversationId, messageId);
            const row = await requestAsPromise<number | undefined>(
              rowIdsStore.get(idKey)
            );
            if (row === undefined) {
              continue;
            }
            const stored = await requestAsPromise<unknown>(
              rowsStore.get(rowKey(conversationId, row))
            );
            if (isCurrentVersion(stored)) {
              for (const token of stored.tokens) {
                const list = rowsByToken.get(token);
                if (list) {
                  list.push(row);
                } else {
                  rowsByToken.set(token, [row]);
                }
              }
            }
            removedAny = true;
            await requestAsPromise(
              rowsStore.delete(rowKey(conversationId, row))
            );
            await requestAsPromise(rowIdsStore.delete(idKey));
          }
          if (!removedAny) {
            return;
          }
          for (const [token, rows] of rowsByToken) {
            const postingKeyForToken = postingKey(conversationId, token);
            const stored = await requestAsPromise<Uint32Array | undefined>(
              postingsStore.get(postingKeyForToken)
            );
            if (!stored) {
              continue;
            }
            const list = searchIndexRowListFrom(stored);
            rowListRemoveMany(list, new Set(rows));
            await writePostingList(
              postingsStore,
              postingKeyForToken,
              rowListToArray(list)
            );
          }
        }
      );
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
  };
}

// Test seam: closes the cached connection and deletes the database, so a test
// starts from a genuinely empty store. The close has to happen first: an open
// connection blocks deleteDatabase, and the delete would then hang rather than
// fail.
export async function resetIndexedDbSearchIndexStoreForTests(): Promise<void> {
  const open = dbPromise;
  dbPromise = null;
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
    request.addEventListener("blocked", () => resolve());
  });
}
