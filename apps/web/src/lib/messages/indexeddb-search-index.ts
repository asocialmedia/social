// IndexedDB backend for the local message search index.
//
// Thin by design: every rule about what an index means lives in
// search-index-format.ts (pure, tested) and in the store contract, so the
// browser backend cannot drift from the tested in-memory reference.
//
// Schema (current):
//
//   tables    conversationId -> { generation, instanceId, revision, sealed: Uint8Array }
//   postings  [conversationId, tokenId] -> Uint32Array of row ids
//   alloc     conversationId -> next row id
//   meta      conversationId -> coverage cursor
//   pending   conversationId -> ids not searchable yet
//
// The row table is ONE sealed AEAD record per conversation rather than one record
// per row, for a reason that was measured: WebCrypto costs about 0.2ms per
// operation and a query resolves up to 2,000 rows, so per-row encryption is
// roughly 400ms per keystroke. Sealing the table once costs a few milliseconds of
// AES (measured 1.3ms to project 2,000 rows from a 200k-row table) and is what
// makes the index unreadable to anyone holding the device database without also
// holding the identity key.
//
// Two consequences, both deliberate:
//
// - Posting keys are token IDs, never token text. A token in an IndexedDB key is
//   plaintext at rest, and the table's own dictionary is what turns the user's
//   words into those ids.
// - `query` is one operation, not three. The token dictionary lives inside the
//   ciphertext, so a caller cannot resolve words to posting keys at all without
//   the table; and doing the steps separately could read the table and the posting
//   lists from different commits.
//
// Fail-tolerant: a denied or corrupt database rejects, and every caller reads that
// as "not indexed" rather than letting it reach the transcript.

import {
  ensureMessagesSchema,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  SEARCH_ALLOC_STORE,
  SEARCH_META_STORE,
  SEARCH_PENDING_STORE,
  SEARCH_POSTINGS_STORE,
  SEARCH_TABLES_STORE,
} from "./message-db";
import {
  emptySearchIndexMeta,
  intersectPostingLists,
  SearchIndexRevisionConflictError,
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
  SearchIndexStore,
} from "./search-index-format";
import {
  decodeRowTable,
  emptySealedRowTable,
  encodeRowTable,
  projectRowTable,
  readTokenDictionary,
  seal,
  unseal,
} from "./search-index-vault";
import type { SealedRowTable, SealContext } from "./search-index-vault";

// Name and version are shared with the identity key store, which opens the same
// database. See message-db.ts: disagreeing versions throw VersionError, and the
// identity store is what makes a DM decryptable at all.
// v1 is the private-key store from crypto.ts. v2 was a superseded search shape.
// v3 interned row ids but still keyed rows by message id. v4 split the row
// allocator out of meta. v5 re-keys rows by row id, which is what lets a query
// resolve only its own matches.
//
// Search layouts before the sealed table are reset rather than migrated: their
// records use incompatible keys, and a mixture is worse than an empty index. The
// index is rebuildable by walking history, so the honest move on upgrade is to
// drop it and re-index.
const TABLES_STORE = SEARCH_TABLES_STORE;
const POSTINGS_STORE = SEARCH_POSTINGS_STORE;
// The row-id allocator, kept out of `search-meta` on purpose: the backfill walk
// rewrites meta on every page, and sharing one object with the write path would
// let the two roll each other's state back. See SearchIndexMeta.
const ALLOC_STORE = SEARCH_ALLOC_STORE;
const META_STORE = SEARCH_META_STORE;
const PENDING_STORE = SEARCH_PENDING_STORE;
const SEARCH_STORES = [
  TABLES_STORE,
  POSTINGS_STORE,
  ALLOC_STORE,
  META_STORE,
  PENDING_STORE,
];
// Bound retries to keep a hot conflict from turning into an unbounded loop.
const MAX_RETRIES = 3;

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

// A posting list is keyed by the token's DICTIONARY ID, never by its text: a
// token in an IndexedDB key is plaintext at rest, which is the exact leak sealing
// the table exists to close.
function postingKeyForId(
  conversationId: string,
  tokenId: number
): [string, string] {
  return [conversationId, `t${tokenId}`];
}

// Range over a conversation's entries in a store keyed [conversationId, string].
function stringKeyRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    postingKey(conversationId, ""),
    postingKey(conversationId, "￿")
  );
}

// The stored record: the sealed table plus what cannot live inside the
// ciphertext. The generation is in the clear so a store can detect a rotated
// conversation's key without attempting a decrypt that cannot succeed.
interface SealedTableRecord {
  generation: string;
  instanceId: string;
  revision: number;
  sealed: Uint8Array;
  version: number;
}

interface ReadableSealedTable {
  generation: string;
  instanceId: string;
  plaintext: Uint8Array;
  record: SealedTableRecord;
  revision: number;
  sealing: SearchIndexSealingKey;
}

type SealedTableRead =
  | { kind: "missing" }
  | { kind: "unavailable" }
  | { kind: "unusable"; record: unknown; sealing: SearchIndexSealingKey }
  | { kind: "usable"; current: ReadableSealedTable };

function isCurrentVersion(value: unknown): value is { version: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === SEARCH_INDEX_FORMAT_VERSION
  );
}

function isSealedTableRecord(value: unknown): value is SealedTableRecord {
  return (
    isCurrentVersion(value) &&
    "generation" in value &&
    typeof value.generation === "string" &&
    "instanceId" in value &&
    typeof value.instanceId === "string" &&
    "revision" in value &&
    typeof value.revision === "number" &&
    "sealed" in value &&
    value.sealed instanceof Uint8Array
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function storedRecordMatches(observed: unknown, latest: unknown): boolean {
  if (observed === undefined || latest === undefined) {
    return observed === latest;
  }
  if (isSealedTableRecord(observed) && isSealedTableRecord(latest)) {
    return (
      observed.generation === latest.generation &&
      observed.instanceId === latest.instanceId &&
      observed.revision === latest.revision &&
      observed.version === latest.version &&
      bytesEqual(observed.sealed, latest.sealed)
    );
  }
  try {
    return JSON.stringify(observed) === JSON.stringify(latest);
  } catch {
    return false;
  }
}

function currentRecordMatches(
  expected: SealedTableRecord,
  latest: unknown
): boolean {
  return (
    isSealedTableRecord(latest) &&
    expected.generation === latest.generation &&
    expected.instanceId === latest.instanceId &&
    expected.revision === latest.revision &&
    expected.version === latest.version &&
    bytesEqual(expected.sealed, latest.sealed)
  );
}

function newTableInstanceId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Where the sealing key comes from. Null when the conversation's root is not
// available yet — a cold load, or before identity unlock. That is not a failure:
// the index simply cannot be read or written, and the caller falls back to
// in-memory search rather than writing anything in the clear.
export interface SearchIndexSealingKey {
  generation: string;
  key: CryptoKey;
}

export type SearchIndexKeyResolver = (
  conversationId: string
) => Promise<SearchIndexSealingKey | null>;

// Raised when no key is available. Callers read this as "not indexed".
export class SearchIndexKeyUnavailableError extends Error {
  constructor(conversationId: string) {
    super(`search index key unavailable for ${conversationId}`);
    this.name = "SearchIndexKeyUnavailableError";
  }
}

// The next row id for a conversation. Zero for one that has never allocated a
// row: to the only caller, absent and zero mean the same thing -- a conversation
// starting its numbering.
function readAllocator(conversationId: string): Promise<number> {
  if (storageUnavailable()) {
    return Promise.resolve(0);
  }
  return runTransaction([ALLOC_STORE], "readonly", async (tx) => {
    const value = await requestAsPromise<number | undefined>(
      tx.objectStore(ALLOC_STORE).get(conversationId)
    );
    return value ?? 0;
  });
}

// Reads and decrypts a conversation's table.
//
// Two transactions, not one, and the reason is not a preference: an IndexedDB
// transaction commits as soon as its request queue drains, and WebCrypto
// `deriveKey`/`decrypt` resolve in a later task rather than a microtask. Awaiting
// a key or a seal inside a transaction therefore lets the transaction go inactive
// before the next request is issued, and every such call rejects. So the record is
// fetched, the transaction completes, and the AEAD work happens with no
// transaction open.
async function readSealedTable(
  conversationId: string,
  resolveKey: SearchIndexKeyResolver
): Promise<SealedTableRead> {
  if (storageUnavailable()) {
    return { kind: "unavailable" };
  }
  const record = await runTransaction([TABLES_STORE], "readonly", (tx) =>
    requestAsPromise<unknown>(tx.objectStore(TABLES_STORE).get(conversationId))
  );
  if (record === undefined) {
    return { kind: "missing" };
  }
  const sealing = await resolveKey(conversationId);
  if (!sealing) {
    return { kind: "unavailable" };
  }
  if (
    !isSealedTableRecord(record) ||
    record.generation !== sealing.generation
  ) {
    return { kind: "unusable", record, sealing };
  }
  let plaintext: Uint8Array;
  try {
    plaintext = await unseal(sealing.key, record.sealed, {
      conversationId,
      keyGeneration: sealing.generation,
    });
  } catch {
    // Wrong key for this table, or corrupt bytes. Reads as "not indexed" rather
    // than throwing into the transcript: search is an enhancement, and the index
    // rebuilds by walking history.
    return { kind: "unusable", record, sealing };
  }
  try {
    decodeRowTable(plaintext);
  } catch {
    return { kind: "unusable", record, sealing };
  }
  return {
    current: {
      generation: sealing.generation,
      instanceId: record.instanceId,
      plaintext,
      record,
      revision: record.revision,
      sealing,
    },
    kind: "usable",
  };
}

export function createIndexedDbSearchIndexStore({
  resolveKey,
}: {
  resolveKey: SearchIndexKeyResolver;
}): SearchIndexStore {
  return {
    clearConversation(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve();
      }
      return runTransaction(SEARCH_STORES, "readwrite", async (tx) => {
        // A handful of sequential range deletes: Promise.all cannot be used
        // because requests issued on a transaction outside its callback's
        // lifetime are rejected, and these are all issued here.
        // oxlint-disable no-await-in-loop
        for (const name of SEARCH_STORES) {
          const store = tx.objectStore(name);
          const keyedByConversationAlone =
            name === TABLES_STORE ||
            name === ALLOC_STORE ||
            name === META_STORE ||
            name === PENDING_STORE;
          await requestAsPromise(
            keyedByConversationAlone
              ? store.delete(conversationId)
              : store.delete(stringKeyRange(conversationId))
          );
        }
        // oxlint-enable no-await-in-loop
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
      // Decrypt, mutate and re-encrypt with no transaction open -- WebCrypto
      // resolves in a later task, and an IDB transaction that waits on it has
      // already committed by then. The revision and instance token read here are
      // checked again inside the write transaction.
      const write = async (): Promise<boolean> => {
        const read = await readSealedTable(conversationId, resolveKey);
        if (read.kind === "unavailable") {
          const sealing = await resolveKey(conversationId);
          if (!sealing) {
            throw new SearchIndexKeyUnavailableError(conversationId);
          }
          return false;
        }
        let current: ReadableSealedTable | null = null;
        let observedRecord: unknown;
        let reset = false;
        let sealing: SearchIndexSealingKey;
        if (read.kind === "missing") {
          observedRecord = undefined;
          const resolved = await resolveKey(conversationId);
          if (!resolved) {
            throw new SearchIndexKeyUnavailableError(conversationId);
          }
          sealing = resolved;
        } else if (read.kind === "unusable") {
          const { sealing: unusableSealing } = read;
          observedRecord = read.record;
          reset = true;
          sealing = unusableSealing;
        } else {
          const { current: readCurrent } = read;
          const { record, sealing: currentSealing } = readCurrent;
          current = readCurrent;
          observedRecord = record;
          sealing = currentSealing;
        }
        const context: SealContext = {
          conversationId,
          keyGeneration: sealing.generation,
        };
        const table: SealedRowTable = current
          ? decodeRowTable(current.plaintext)
          : emptySealedRowTable();

        // The dictionary is append-only: token ids are what the posting keys are,
        // so an existing id must never move.
        const dictionary = [...(table.tokenDictionary ?? [])];
        const tokenIdByText = new Map(
          dictionary.map((token, id) => [token, id])
        );
        const rowByMessageId = new Map<string, number>();
        for (const [row, messageId] of table.messageIdByRow.entries()) {
          rowByMessageId.set(messageId, row);
        }
        const rowMutations: {
          droppedTokenIds: number[];
          row: number;
          tokenIds: number[];
        }[] = [];

        const nextRow = reset ? 0 : await readAllocator(conversationId);
        let nextRowId = nextRow;
        for (const [messageId, entry] of entries) {
          let row = rowByMessageId.get(messageId);
          if (row === undefined) {
            row = nextRowId;
            nextRowId += 1;
            rowByMessageId.set(messageId, row);
            table.messageIdByRow[row] = messageId;
            table.createdAtByRow[row] = entry.createdAt;
            table.senderIdByRow[row] = entry.senderId;
            table.presentByRow[row] = true;
            table.tokensByRow[row] = [];
          } else if (table.presentByRow[row] === false) {
            // A tombstone must not be revived by a stale device's re-index.
            continue;
          }
          const previousTokens = table.tokensByRow[row] ?? [];
          for (const token of entry.tokens) {
            if (!tokenIdByText.has(token)) {
              tokenIdByText.set(token, dictionary.length);
              dictionary.push(token);
            }
          }
          // A token the rewrite dropped must leave the posting list too, or the
          // message would keep matching a word it no longer contains. Resolved
          // through the append-only dictionary, so a dropped token still maps to
          // the id its posting list is keyed by.
          const droppedTokenIds: number[] = [];
          for (const oldToken of previousTokens) {
            if (entry.tokens.includes(oldToken)) {
              continue;
            }
            const oldId = tokenIdByText.get(oldToken);
            if (oldId !== undefined) {
              droppedTokenIds.push(oldId);
            }
          }
          table.tokensByRow[row] = [...entry.tokens];
          rowMutations.push({
            droppedTokenIds,
            row,
            tokenIds: entry.tokens.map(
              (token) => tokenIdByText.get(token) ?? 0
            ),
          });
        }
        if (rowMutations.length === 0) {
          return true;
        }
        table.tokenDictionary = dictionary;
        const sealed = await seal(sealing.key, encodeRowTable(table), context);
        const instanceId =
          reset || current === null ? newTableInstanceId() : current.instanceId;

        await runTransaction(
          [TABLES_STORE, POSTINGS_STORE, ALLOC_STORE, META_STORE],
          "readwrite",
          async (tx) => {
            const tablesStore = tx.objectStore(TABLES_STORE);
            const latest = await requestAsPromise<unknown>(
              tablesStore.get(conversationId)
            );
            if (!storedRecordMatches(observedRecord, latest)) {
              throw new SearchIndexRevisionConflictError(conversationId);
            }
            const postingsStore = tx.objectStore(POSTINGS_STORE);
            const allocStore = tx.objectStore(ALLOC_STORE);
            const metaStore = tx.objectStore(META_STORE);
            if (reset) {
              await requestAsPromise(tablesStore.delete(conversationId));
              await requestAsPromise(
                postingsStore.delete(stringKeyRange(conversationId))
              );
              await requestAsPromise(allocStore.delete(conversationId));
              await requestAsPromise(
                metaStore.put(
                  emptySearchIndexMeta(conversationId),
                  conversationId
                )
              );
            }
            // oxlint-disable no-await-in-loop -- sequential point reads and writes; Promise.all cannot batch requests issued on one transaction
            for (const mutation of rowMutations) {
              for (const tokenId of mutation.tokenIds) {
                const key = postingKeyForId(conversationId, tokenId);
                const list = searchIndexRowListFrom(
                  (await requestAsPromise<Uint32Array | undefined>(
                    postingsStore.get(key)
                  )) ?? new Uint32Array(0)
                );
                rowListAdd(list, mutation.row);
                await writePostingList(
                  postingsStore,
                  key,
                  rowListToArray(list)
                );
              }
              for (const tokenId of mutation.droppedTokenIds) {
                const key = postingKeyForId(conversationId, tokenId);
                const existing = await requestAsPromise<
                  Uint32Array | undefined
                >(postingsStore.get(key));
                if (!existing) {
                  continue;
                }
                const list = searchIndexRowListFrom(existing);
                rowListRemove(list, mutation.row);
                await writePostingList(
                  postingsStore,
                  key,
                  rowListToArray(list)
                );
              }
            }
            // oxlint-enable no-await-in-loop
            await requestAsPromise(
              tablesStore.put(
                {
                  generation: sealing.generation,
                  instanceId,
                  revision: current === null ? 1 : current.revision + 1,
                  sealed,
                  version: SEARCH_INDEX_FORMAT_VERSION,
                },
                conversationId
              )
            );
            await requestAsPromise(allocStore.put(nextRowId, conversationId));
          }
        );
        return true;
      };
      return (async () => {
        // Retry here so every caller benefits: the writer treats a generic
        // rejection as still pending, and a one-shot conflict would let its
        // cursor advance past a page that was never written.
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- retries must re-read and recompute sequentially
            if (await write()) {
              return;
            }
          } catch (error) {
            if (
              !(error instanceof SearchIndexRevisionConflictError) ||
              attempt === MAX_RETRIES - 1
            ) {
              throw error;
            }
          }
        }
      })();
    },

    // One operation for the whole query, because the token dictionary lives inside
    // the ciphertext: a caller cannot turn words into posting keys without the
    // table. The second transaction checks the table snapshot before reading
    // postings, so a writer cannot mix two revisions during one keystroke.
    query(conversationId, tokens, limit) {
      if (storageUnavailable() || tokens.length === 0) {
        return Promise.resolve({ rows: new Map(), totalMatched: 0 });
      }
      return (async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- retries must re-read and recompute sequentially
            const read = await readSealedTable(conversationId, resolveKey);
            if (read.kind !== "usable") {
              return { rows: new Map(), totalMatched: 0 };
            }
            const { current } = read;
            // The dictionary is the only part of the table a query must read in full;
            // the rows themselves are projected afterwards.
            const tokenIdByText = new Map(
              readTokenDictionary(current.plaintext).map((token, id) => [
                token,
                id,
              ])
            );
            const wanted: number[] = [];
            // Every token must be known. The words are ANDed, so one word the index
            // has never seen means the message cannot contain all of them: dropping
            // the unknown word instead would turn `deploy zzz` into `deploy` and
            // return a false positive, which is the worst possible failure for a
            // search box. It also means the posting store is never touched.
            let unknownToken = false;
            for (const token of tokens) {
              const id = tokenIdByText.get(token);
              if (id === undefined) {
                unknownToken = true;
                break;
              }
              wanted.push(id);
            }
            if (unknownToken || wanted.length === 0) {
              return { rows: new Map(), totalMatched: 0 };
            }
            // oxlint-disable-next-line no-await-in-loop -- a checked snapshot is retried sequentially
            const lists = await runTransaction(
              [TABLES_STORE, POSTINGS_STORE],
              "readonly",
              async (tx) => {
                const tablesStore = tx.objectStore(TABLES_STORE);
                const latest = await requestAsPromise<unknown>(
                  tablesStore.get(conversationId)
                );
                if (!currentRecordMatches(current.record, latest)) {
                  throw new SearchIndexRevisionConflictError(conversationId);
                }
                const postingsStore = tx.objectStore(POSTINGS_STORE);
                // oxlint-disable no-await-in-loop -- sequential point reads on one transaction; Promise.all would issue requests outside its lifetime
                const out: Uint32Array[] = [];
                for (const id of wanted) {
                  out.push(
                    (await requestAsPromise<Uint32Array | undefined>(
                      postingsStore.get(postingKeyForId(conversationId, id))
                    )) ?? new Uint32Array(0)
                  );
                }
                // oxlint-enable no-await-in-loop
                return out;
              }
            );
            const { rows, totalMatched } = intersectPostingLists(lists, limit);
            return {
              rows: projectRowTable(current.plaintext, rows),
              totalMatched,
            };
          } catch (error) {
            if (
              !(error instanceof SearchIndexRevisionConflictError) ||
              attempt === MAX_RETRIES - 1
            ) {
              throw error;
            }
          }
        }
        throw new Error("search index query retry limit reached");
      })();
    },

    // Bulk read for deliberate structural tests and whole-index accounting,
    // never the keystroke path. It uses the same checked snapshot as query.
    // Keyed by token TEXT, resolved back through the table's dictionary.
    readAllPostingLists(conversationId: string) {
      if (storageUnavailable()) {
        return Promise.resolve(new Map<string, Uint32Array>());
      }
      const readAll = async (): Promise<Map<string, Uint32Array>> => {
        const tableRead = await readSealedTable(conversationId, resolveKey);
        if (tableRead.kind !== "usable") {
          return new Map<string, Uint32Array>();
        }
        const { current } = tableRead;
        const dictionary = readTokenDictionary(current.plaintext);
        const out = new Map<string, Uint32Array>();
        if (dictionary.length === 0) {
          return out;
        }
        const lists = await runTransaction(
          [TABLES_STORE, POSTINGS_STORE],
          "readonly",
          async (tx) => {
            const tablesStore = tx.objectStore(TABLES_STORE);
            const latest = await requestAsPromise<unknown>(
              tablesStore.get(conversationId)
            );
            if (!currentRecordMatches(current.record, latest)) {
              throw new SearchIndexRevisionConflictError(conversationId);
            }
            const postingsStore = tx.objectStore(POSTINGS_STORE);
            // oxlint-disable no-await-in-loop -- sequential point reads on one transaction
            const listsById: Uint32Array[] = [];
            for (const id of dictionary.keys()) {
              listsById.push(
                (await requestAsPromise<Uint32Array | undefined>(
                  postingsStore.get(postingKeyForId(conversationId, id))
                )) ?? new Uint32Array(0)
              );
            }
            // oxlint-enable no-await-in-loop
            return listsById;
          }
        );
        for (const [id, list] of lists.entries()) {
          const token = dictionary[id];
          if (token !== undefined && list.length > 0) {
            out.set(token, list);
          }
        }
        return out;
      };
      return (async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- retries must re-read and recompute sequentially
            return await readAll();
          } catch (error) {
            if (
              !(error instanceof SearchIndexRevisionConflictError) ||
              attempt === MAX_RETRIES - 1
            ) {
              throw error;
            }
          }
        }
        throw new Error("search index posting-list retry limit reached");
      })();
    },

    readMeta(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve(null);
      }
      return runTransaction([META_STORE], "readonly", async (tx) => {
        const value = await requestAsPromise<SearchIndexMeta | undefined>(
          tx.objectStore(META_STORE).get(conversationId)
        );
        if (
          !value ||
          !isCurrentVersion(value) ||
          value.conversationId !== conversationId
        ) {
          // A record this build cannot read is treated as absent, so the
          // conversation re-walks from scratch rather than trusting a shape it
          // does not understand.
          return null;
        }
        // A copy, so a caller mutating the result cannot corrupt what is stored.
        return { ...value, pendingIds: [...value.pendingIds] };
      });
    },

    readPending(conversationId) {
      if (storageUnavailable()) {
        return Promise.resolve([]);
      }
      return runTransaction([PENDING_STORE], "readonly", async (tx) => {
        const value = await requestAsPromise<string[] | undefined>(
          tx.objectStore(PENDING_STORE).get(conversationId)
        );
        return value ?? [];
      });
    },

    // Resolves only requested rows. The keystroke path uses query, which does
    // this projection as part of its checked snapshot.
    readRows(conversationId, rowIds) {
      if (storageUnavailable() || rowIds.length === 0) {
        return Promise.resolve(new Map());
      }
      return (async () => {
        const read = await readSealedTable(conversationId, resolveKey);
        return read.kind === "usable"
          ? projectRowTable(read.current.plaintext, rowIds)
          : new Map();
      })();
    },

    // One point read of the allocator's high-water mark. No key derivation or
    // table decryption is needed for this cumulative coverage count.
    readStats(conversationId) {
      return readAllocator(conversationId).then((indexedRowCount) => ({
        indexedRowCount,
      }));
    },

    removeEntries(conversationId, messageIds) {
      if (storageUnavailable() || messageIds.length === 0) {
        return Promise.resolve();
      }
      const remove = async (): Promise<void> => {
        const read = await readSealedTable(conversationId, resolveKey);
        if (read.kind === "missing" || read.kind === "unavailable") {
          return;
        }
        if (read.kind === "unusable") {
          await runTransaction(
            [TABLES_STORE, POSTINGS_STORE, ALLOC_STORE, META_STORE],
            "readwrite",
            async (tx) => {
              const tablesStore = tx.objectStore(TABLES_STORE);
              const latest = await requestAsPromise<unknown>(
                tablesStore.get(conversationId)
              );
              if (!storedRecordMatches(read.record, latest)) {
                throw new SearchIndexRevisionConflictError(conversationId);
              }
              const metaStore = tx.objectStore(META_STORE);
              await requestAsPromise(tablesStore.delete(conversationId));
              await requestAsPromise(
                tx
                  .objectStore(POSTINGS_STORE)
                  .delete(stringKeyRange(conversationId))
              );
              await requestAsPromise(
                tx.objectStore(ALLOC_STORE).delete(conversationId)
              );
              await requestAsPromise(
                metaStore.put(
                  emptySearchIndexMeta(conversationId),
                  conversationId
                )
              );
            }
          );
          return;
        }
        const { current } = read;
        const table = decodeRowTable(current.plaintext);
        const rowByMessageId = new Map<string, number>();
        for (const [row, messageId] of table.messageIdByRow.entries()) {
          rowByMessageId.set(messageId, row);
        }
        const removedRows: number[] = [];
        for (const messageId of messageIds) {
          const row = rowByMessageId.get(messageId);
          if (row === undefined || table.presentByRow[row] === false) {
            continue;
          }
          removedRows.push(row);
          // A tombstone, not a hole. Dropping the row outright would let an older
          // device's table refill it, resurfacing a deleted message as a search
          // result.
          table.presentByRow[row] = false;
          table.tokensByRow[row] = [];
        }
        if (removedRows.length === 0) {
          return;
        }
        const tokenIds = (table.tokenDictionary ?? []).map((_, id) => id);
        const sealed = await seal(current.sealing.key, encodeRowTable(table), {
          conversationId,
          keyGeneration: current.generation,
        });
        const rowsToRemove = new Set(removedRows);
        await runTransaction(
          [TABLES_STORE, POSTINGS_STORE],
          "readwrite",
          async (tx) => {
            const tablesStore = tx.objectStore(TABLES_STORE);
            const latest = await requestAsPromise<unknown>(
              tablesStore.get(conversationId)
            );
            if (!storedRecordMatches(current.record, latest)) {
              throw new SearchIndexRevisionConflictError(conversationId);
            }
            const postingsStore = tx.objectStore(POSTINGS_STORE);
            // oxlint-disable no-await-in-loop -- sequential point reads and writes on one transaction
            for (const id of tokenIds) {
              const key = postingKeyForId(conversationId, id);
              const existing = await requestAsPromise<Uint32Array | undefined>(
                postingsStore.get(key)
              );
              if (!existing) {
                continue;
              }
              const list = searchIndexRowListFrom(existing);
              rowListRemoveMany(list, rowsToRemove);
              await writePostingList(postingsStore, key, rowListToArray(list));
            }
            // oxlint-enable no-await-in-loop
            await requestAsPromise(
              tablesStore.put(
                {
                  generation: current.generation,
                  instanceId: current.instanceId,
                  revision: current.revision + 1,
                  sealed,
                  version: SEARCH_INDEX_FORMAT_VERSION,
                },
                conversationId
              )
            );
          }
        );
      };
      return (async () => {
        // Keep conflict recovery inside the store so delete callers cannot skip
        // a tombstone or advance past a page that was not actually written.
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- retries must re-read and recompute sequentially
            await remove();
            return;
          } catch (error) {
            if (
              !(error instanceof SearchIndexRevisionConflictError) ||
              attempt === MAX_RETRIES - 1
            ) {
              throw error;
            }
          }
        }
      })();
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

    writePending(conversationId, messageIds) {
      if (storageUnavailable()) {
        return Promise.resolve();
      }
      return runTransaction([PENDING_STORE], "readwrite", async (tx) => {
        const store = tx.objectStore(PENDING_STORE);
        // An empty set is a delete rather than an empty record, so a conversation
        // that has caught up leaves nothing behind.
        if (messageIds.length === 0) {
          await requestAsPromise(store.delete(conversationId));
          return;
        }
        await requestAsPromise(store.put([...messageIds], conversationId));
      });
    },
  };
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
