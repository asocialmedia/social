import {
  OFFLINE_SEARCH_DOCUMENTS_BY_CONVERSATION_INDEX,
  OFFLINE_SEARCH_DOCUMENTS_STORE,
  OFFLINE_SEARCH_PAYLOADS_STORE,
  OFFLINE_SEARCH_STATE_STORE,
  OFFLINE_SEARCH_TOMBSTONES_BY_CONVERSATION_INDEX,
  OFFLINE_SEARCH_TOMBSTONES_STORE,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  ensureMessagesSchema,
} from "./message-db";
import {
  estimateOfflineSearchRecordBytes,
  offlineSearchRecords,
  OFFLINE_SEARCH_MAX_ACCOUNT_BYTES,
  OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION,
} from "./offline-search-cache";
import type {
  OfflineSearchCacheRecord,
  OfflineSearchCursor,
  OfflineSearchPage,
  OfflineSearchReference,
} from "./offline-search-cache";

export const OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES = 32;
export const OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES = 256 * 1024;

export interface OfflineSearchCacheScope {
  recoveryGeneration: number;
  userId: string;
}

export interface OfflineSearchPayload {
  ciphertext: string;
  iv: string;
  keyEpoch: number | null;
  ratchetIndex: number;
  senderId: string;
}

export type OfflineSearchCachePage =
  OfflineSearchPage<OfflineSearchCacheRecord>;

export interface OfflineSearchWriteResult {
  evictedMessageIds: { conversationId: string; id: string }[];
  reason?: "batch-limit" | "invalid-record" | "scope-mismatch" | "unavailable";
  stored: boolean;
  totalBytes: number;
}

interface OfflineSearchDocument {
  byteLength: number;
  cachedAt: number;
  conversationId: string;
  createdAt: number;
  id: string;
  references: OfflineSearchReference[];
  revision: number;
  terms: string[];
}

interface OfflineSearchStoredPayload extends OfflineSearchPayload {
  conversationId: string;
  id: string;
}

interface OfflineSearchScopeState extends OfflineSearchCacheScope {
  id: "active-scope";
}

interface OfflineSearchConversationState {
  byteLength: number;
  conversationId: string;
  id: string;
  lastAccessedAt: number;
  messageCount: number;
}

export interface OfflineSearchCacheRemoval {
  id: string;
  revisionFloor: number | null;
  sequence: number | null;
  unavailable: boolean;
}

interface OfflineSearchTombstone extends OfflineSearchCacheRemoval {
  conversationId: string;
}

export interface IndexedDbOfflineSearchCacheStore {
  activateScope: (scope: OfflineSearchCacheScope) => Promise<boolean>;
  clearConversation: (
    scope: OfflineSearchCacheScope,
    conversationId: string
  ) => Promise<boolean>;
  clearScope: (scope: OfflineSearchCacheScope) => Promise<boolean>;
  getMessages: (
    scope: OfflineSearchCacheScope,
    conversationId: string,
    messageIds: readonly string[]
  ) => Promise<Map<string, OfflineSearchPayload>>;
  putBatch: (input: {
    activeConversationId: string;
    records: readonly OfflineSearchCacheRecord[];
    scope: OfflineSearchCacheScope;
  }) => Promise<OfflineSearchWriteResult>;
  removeMessages: (
    scope: OfflineSearchCacheScope,
    conversationId: string,
    messageIds: readonly string[],
    removals?: readonly OfflineSearchCacheRemoval[]
  ) => Promise<boolean>;
  search: (input: {
    after?: OfflineSearchCursor;
    before?: OfflineSearchCursor;
    conversationId: string;
    limit?: number;
    query: string;
    scope: OfflineSearchCacheScope;
  }) => Promise<OfflineSearchCachePage | null>;
}

const SCOPE_KEY = "active-scope";
const CONVERSATION_KEY_PREFIX = "conversation:";

let dbPromise: Promise<IDBDatabase> | null = null;
let staleConnection = false;

function scopeMatches(
  value: unknown,
  scope: OfflineSearchCacheScope
): value is OfflineSearchScopeState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<OfflineSearchScopeState>;
  return (
    candidate.id === SCOPE_KEY &&
    candidate.userId === scope.userId &&
    candidate.recoveryGeneration === scope.recoveryGeneration
  );
}

function validScope(scope: OfflineSearchCacheScope): boolean {
  return (
    typeof scope.userId === "string" &&
    scope.userId.length > 0 &&
    Number.isSafeInteger(scope.recoveryGeneration) &&
    scope.recoveryGeneration >= 0
  );
}

function conversationStateKey(conversationId: string): string {
  return `${CONVERSATION_KEY_PREFIX}${conversationId}`;
}

function messageKey(conversationId: string, id: string): string {
  return JSON.stringify([conversationId, id]);
}

function tombstoneKey(conversationId: string, id: string): string {
  return JSON.stringify([conversationId, id]);
}

function validRecord(record: OfflineSearchCacheRecord): boolean {
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.conversationId === "string" &&
    record.conversationId.length > 0 &&
    Number.isSafeInteger(record.createdAt) &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0 &&
    Number.isFinite(record.cachedAt) &&
    Number.isSafeInteger(record.ratchetIndex) &&
    record.ratchetIndex >= 0 &&
    (record.keyEpoch === null ||
      (Number.isSafeInteger(record.keyEpoch) && record.keyEpoch >= 0)) &&
    typeof record.senderId === "string" &&
    record.senderId.length > 0 &&
    Array.isArray(record.terms) &&
    record.terms.every((term) => typeof term === "string") &&
    Array.isArray(record.references) &&
    record.references.every(
      (reference) =>
        Number.isSafeInteger(reference.index) &&
        reference.index >= 0 &&
        (reference.id === undefined || typeof reference.id === "string")
    ) &&
    typeof record.ciphertext === "string" &&
    record.ciphertext.length > 0 &&
    typeof record.iv === "string" &&
    record.iv.length > 0
  );
}

function failedWrite(
  reason: OfflineSearchWriteResult["reason"]
): OfflineSearchWriteResult {
  return {
    evictedMessageIds: [],
    reason,
    stored: false,
    totalBytes: 0,
  };
}

function documentFromRecord(
  record: OfflineSearchCacheRecord
): OfflineSearchDocument {
  return {
    byteLength: estimateOfflineSearchRecordBytes(record),
    cachedAt: record.cachedAt,
    conversationId: record.conversationId,
    createdAt: record.createdAt,
    id: record.id,
    references: record.references,
    revision: record.revision,
    terms: record.terms,
  };
}

function payloadFromRecord(
  record: OfflineSearchCacheRecord
): OfflineSearchStoredPayload {
  return {
    ciphertext: record.ciphertext,
    conversationId: record.conversationId,
    id: record.id,
    iv: record.iv,
    keyEpoch: record.keyEpoch,
    ratchetIndex: record.ratchetIndex,
    senderId: record.senderId,
  };
}

function recordFromParts(
  document: OfflineSearchDocument,
  payload: OfflineSearchStoredPayload
): OfflineSearchCacheRecord {
  return {
    cachedAt: document.cachedAt,
    ciphertext: payload.ciphertext,
    conversationId: document.conversationId,
    createdAt: document.createdAt,
    id: document.id,
    iv: payload.iv,
    keyEpoch: payload.keyEpoch,
    ratchetIndex: payload.ratchetIndex,
    references: document.references,
    revision: document.revision,
    senderId: payload.senderId,
    terms: document.terms,
  };
}

function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!storageAvailable()) {
    throw new Error("IndexedDB is unavailable");
  }
  if (dbPromise) {
    const current = await dbPromise;
    if (!staleConnection) {
      return current;
    }
    staleConnection = false;
    dbPromise = null;
  }
  // eslint-disable-next-line promise/avoid-new -- IndexedDB open is event-based
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
    let settled = false;
    request.addEventListener("upgradeneeded", (event) => {
      ensureMessagesSchema(request.result, event.oldVersion);
    });
    request.addEventListener("success", () => {
      const db = request.result;
      db.onversionchange = () => {
        staleConnection = true;
        db.close();
      };
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    });
    request.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error("IndexedDB open failed"));
      }
    });
    request.addEventListener("blocked", () => {
      if (!settled) {
        settled = true;
        reject(new Error("IndexedDB upgrade is blocked by another tab"));
      }
    });
  });
  dbPromise = pending;
  try {
    return await pending;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  // eslint-disable-next-line promise/avoid-new -- IndexedDB requests are event-based
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
    );
  });
}

async function runTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  // eslint-disable-next-line promise/avoid-new -- IndexedDB transactions are event-based
  return await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result: T;
    let transactionComplete = false;
    let workSettled = false;
    let failed = false;
    const settle = () => {
      if (!failed && transactionComplete && workSettled) {
        resolve(result);
      }
    };
    transaction.addEventListener("complete", () => {
      transactionComplete = true;
      settle();
    });
    transaction.addEventListener("error", () => {
      failed = true;
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });
    transaction.addEventListener("abort", () => {
      failed = true;
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
    void Promise.resolve(work(transaction))
      .then((value) => {
        result = value;
        workSettled = true;
        settle();
      })
      .catch((error: unknown) => {
        failed = true;
        try {
          transaction.abort();
        } catch {
          // The transaction may already be aborting.
        }
        reject(error);
      });
  });
}

function documentRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [conversationId, -Number.MAX_SAFE_INTEGER, ""],
    [conversationId, Number.MAX_SAFE_INTEGER, "\uFFFF"]
  );
}

async function documentsForConversation(
  store: IDBObjectStore,
  conversationId: string
): Promise<OfflineSearchDocument[]> {
  return (await requestAsPromise(
    store
      .index(OFFLINE_SEARCH_DOCUMENTS_BY_CONVERSATION_INDEX)
      .getAll(documentRange(conversationId))
  )) as OfflineSearchDocument[];
}

async function tombstonesForConversation(
  store: IDBObjectStore,
  conversationId: string
): Promise<OfflineSearchTombstone[]> {
  return (await requestAsPromise(
    store
      .index(OFFLINE_SEARCH_TOMBSTONES_BY_CONVERSATION_INDEX)
      .getAll(IDBKeyRange.only(conversationId))
  )) as OfflineSearchTombstone[];
}

function asConversationState(
  value: unknown
): OfflineSearchConversationState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<OfflineSearchConversationState>;
  if (
    typeof candidate.conversationId !== "string" ||
    typeof candidate.id !== "string" ||
    typeof candidate.messageCount !== "number" ||
    typeof candidate.byteLength !== "number" ||
    typeof candidate.lastAccessedAt !== "number"
  ) {
    return null;
  }
  return candidate as OfflineSearchConversationState;
}

function writeConversationState(
  store: IDBObjectStore,
  conversationId: string,
  docs: readonly OfflineSearchDocument[],
  lastAccessedAt: number
): number {
  const byteLength = docs.reduce(
    (sum, document) => sum + document.byteLength,
    0
  );
  const id = conversationStateKey(conversationId);
  if (docs.length === 0) {
    store.delete(id);
  } else {
    store.put(
      {
        byteLength,
        conversationId,
        id,
        lastAccessedAt,
        messageCount: docs.length,
      } satisfies OfflineSearchConversationState,
      id
    );
  }
  return byteLength;
}

function oldestFirst(
  left: OfflineSearchDocument,
  right: OfflineSearchDocument
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function newFirst(
  left: OfflineSearchDocument,
  right: OfflineSearchDocument
): number {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
}

export function createIndexedDbOfflineSearchCacheStore(): IndexedDbOfflineSearchCacheStore {
  async function activateScope(
    scope: OfflineSearchCacheScope
  ): Promise<boolean> {
    if (!validScope(scope)) {
      return false;
    }
    try {
      return await runTransaction(
        [
          OFFLINE_SEARCH_DOCUMENTS_STORE,
          OFFLINE_SEARCH_PAYLOADS_STORE,
          OFFLINE_SEARCH_STATE_STORE,
          OFFLINE_SEARCH_TOMBSTONES_STORE,
        ],
        "readwrite",
        async (transaction) => {
          const state = transaction.objectStore(OFFLINE_SEARCH_STATE_STORE);
          const active = await requestAsPromise(state.get(SCOPE_KEY));
          if (scopeMatches(active, scope)) {
            return true;
          }
          transaction.objectStore(OFFLINE_SEARCH_DOCUMENTS_STORE).clear();
          transaction.objectStore(OFFLINE_SEARCH_PAYLOADS_STORE).clear();
          transaction.objectStore(OFFLINE_SEARCH_TOMBSTONES_STORE).clear();
          state.clear();
          state.put(
            { id: SCOPE_KEY, ...scope } satisfies OfflineSearchScopeState,
            SCOPE_KEY
          );
          return true;
        }
      );
    } catch {
      return false;
    }
  }

  async function putBatch(input: {
    activeConversationId: string;
    records: readonly OfflineSearchCacheRecord[];
    scope: OfflineSearchCacheScope;
  }): Promise<OfflineSearchWriteResult> {
    if (!validScope(input.scope)) {
      return failedWrite("invalid-record");
    }
    if (input.records.length > OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES) {
      return failedWrite("batch-limit");
    }
    let inputBytes = 0;
    try {
      for (const record of input.records) {
        if (!validRecord(record)) {
          return failedWrite("invalid-record");
        }
        inputBytes += estimateOfflineSearchRecordBytes(record);
      }
    } catch {
      return failedWrite("invalid-record");
    }
    if (inputBytes > OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES) {
      return failedWrite("batch-limit");
    }

    try {
      return await runTransaction(
        [
          OFFLINE_SEARCH_DOCUMENTS_STORE,
          OFFLINE_SEARCH_PAYLOADS_STORE,
          OFFLINE_SEARCH_STATE_STORE,
          OFFLINE_SEARCH_TOMBSTONES_STORE,
        ],
        "readwrite",
        async (transaction) => {
          const documentStore = transaction.objectStore(
            OFFLINE_SEARCH_DOCUMENTS_STORE
          );
          const payloadStore = transaction.objectStore(
            OFFLINE_SEARCH_PAYLOADS_STORE
          );
          const stateStore = transaction.objectStore(
            OFFLINE_SEARCH_STATE_STORE
          );
          const tombstoneStore = transaction.objectStore(
            OFFLINE_SEARCH_TOMBSTONES_STORE
          );
          const state = await requestAsPromise(stateStore.get(SCOPE_KEY));
          if (!scopeMatches(state, input.scope)) {
            return failedWrite("scope-mismatch");
          }

          const incomingByKey = new Map<string, OfflineSearchCacheRecord>();
          for (const record of input.records) {
            const key = messageKey(record.conversationId, record.id);
            const prior = incomingByKey.get(key);
            if (!prior || record.revision > prior.revision) {
              incomingByKey.set(key, record);
            }
          }
          const tombstoneValues = await Promise.all(
            [...incomingByKey.values()].map((record) =>
              requestAsPromise(
                tombstoneStore.get(
                  tombstoneKey(record.conversationId, record.id)
                )
              )
            )
          );
          const eligibleByKey = new Map<string, OfflineSearchCacheRecord>();
          let tombstoneIndex = 0;
          for (const [key, record] of incomingByKey) {
            const tombstone = tombstoneValues[tombstoneIndex] as
              | OfflineSearchTombstone
              | undefined;
            tombstoneIndex += 1;
            if (!tombstone) {
              eligibleByKey.set(key, record);
              continue;
            }
            if (
              tombstone.unavailable ||
              (tombstone.revisionFloor !== null &&
                record.revision < tombstone.revisionFloor)
            ) {
              continue;
            }
            eligibleByKey.set(key, record);
          }
          const touchedConversationIds = [
            ...new Set(
              [...eligibleByKey.values()].map((record) => record.conversationId)
            ),
          ];
          const existingByConversation = new Map<
            string,
            OfflineSearchDocument[]
          >();
          const oldDocuments = await Promise.all(
            [...eligibleByKey.values()].map((record) =>
              requestAsPromise(
                documentStore.get(messageKey(record.conversationId, record.id))
              )
            )
          );
          const oldDocumentByKey = new Map<string, OfflineSearchDocument>();
          let oldIndex = 0;
          for (const record of eligibleByKey.values()) {
            const old = oldDocuments[oldIndex] as
              | OfflineSearchDocument
              | undefined;
            oldIndex += 1;
            if (old) {
              oldDocumentByKey.set(
                messageKey(record.conversationId, record.id),
                old
              );
            }
          }
          await Promise.all(
            touchedConversationIds.map(async (conversationId) => {
              existingByConversation.set(
                conversationId,
                await documentsForConversation(documentStore, conversationId)
              );
            })
          );

          const incomingAccepted = [...eligibleByKey.values()].filter(
            (record) => {
              const old = oldDocumentByKey.get(
                messageKey(record.conversationId, record.id)
              );
              return !old || record.revision > old.revision;
            }
          );
          const docByConversation = new Map<
            string,
            Map<string, OfflineSearchDocument>
          >();
          for (const conversationId of touchedConversationIds) {
            docByConversation.set(
              conversationId,
              new Map(
                (existingByConversation.get(conversationId) ?? []).map(
                  (doc) => [doc.id, doc]
                )
              )
            );
          }
          for (const record of incomingAccepted) {
            docByConversation
              .get(record.conversationId)
              ?.set(record.id, documentFromRecord(record));
          }

          const evicted = new Map<
            string,
            { conversationId: string; id: string }
          >();
          const finalByConversation = new Map<
            string,
            OfflineSearchDocument[]
          >();
          const now = Date.now();
          for (const conversationId of touchedConversationIds) {
            const docs = [
              ...(docByConversation.get(conversationId)?.values() ?? []),
            ].toSorted(newFirst);
            const finalDocs = docs.slice(
              0,
              OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION
            );
            const keepIds = new Set(finalDocs.map((doc) => doc.id));
            for (const doc of docs) {
              if (!keepIds.has(doc.id)) {
                evicted.set(messageKey(conversationId, doc.id), {
                  conversationId,
                  id: doc.id,
                });
              }
            }
            finalByConversation.set(conversationId, finalDocs);
          }

          const acceptedByKey = new Map(
            incomingAccepted.map((record) => [
              messageKey(record.conversationId, record.id),
              record,
            ])
          );
          for (const conversationId of touchedConversationIds) {
            const priorDocs = existingByConversation.get(conversationId) ?? [];
            const keepIds = new Set(
              (finalByConversation.get(conversationId) ?? []).map(
                (doc) => doc.id
              )
            );
            for (const old of priorDocs) {
              const replacement = acceptedByKey.get(
                messageKey(conversationId, old.id)
              );
              if (!keepIds.has(old.id) || replacement) {
                const key = messageKey(conversationId, old.id);
                documentStore.delete(key);
                payloadStore.delete(key);
              }
            }
            for (const record of incomingAccepted) {
              if (
                record.conversationId !== conversationId ||
                !keepIds.has(record.id)
              ) {
                continue;
              }
              const key = messageKey(conversationId, record.id);
              documentStore.put(documentFromRecord(record), key);
              payloadStore.put(payloadFromRecord(record), key);
            }
            writeConversationState(
              stateStore,
              conversationId,
              finalByConversation.get(conversationId) ?? [],
              now
            );
          }

          const stateValues = await requestAsPromise(stateStore.getAll());
          const conversationStates = new Map<
            string,
            OfflineSearchConversationState
          >();
          for (const value of stateValues) {
            const summary = asConversationState(value);
            if (summary) {
              conversationStates.set(summary.conversationId, summary);
            }
          }
          let totalBytes = [...conversationStates.values()].reduce(
            (sum, summary) => sum + summary.byteLength,
            0
          );
          const candidates = [...conversationStates.values()]
            .filter(
              (summary) => summary.conversationId !== input.activeConversationId
            )
            .toSorted(
              (left, right) => left.lastAccessedAt - right.lastAccessedAt
            );
          const evictFromConversation = (
            conversationId: string,
            docs: OfflineSearchDocument[],
            currentBytes: number
          ): number => {
            let bytes = currentBytes;
            for (const doc of docs.toSorted(oldestFirst)) {
              if (totalBytes <= OFFLINE_SEARCH_MAX_ACCOUNT_BYTES) {
                break;
              }
              const key = messageKey(conversationId, doc.id);
              documentStore.delete(key);
              payloadStore.delete(key);
              evicted.set(key, { conversationId, id: doc.id });
              bytes -= doc.byteLength;
              totalBytes -= doc.byteLength;
            }
            const kept = docs.filter(
              (doc) => !evicted.has(messageKey(conversationId, doc.id))
            );
            writeConversationState(
              stateStore,
              conversationId,
              kept,
              conversationStates.get(conversationId)?.lastAccessedAt ?? now
            );
            return bytes;
          };

          // oxlint-disable no-await-in-loop -- eviction order depends on each prior byte update
          for (const summary of candidates) {
            if (totalBytes <= OFFLINE_SEARCH_MAX_ACCOUNT_BYTES) {
              break;
            }
            const docs = await documentsForConversation(
              documentStore,
              summary.conversationId
            );
            evictFromConversation(
              summary.conversationId,
              docs,
              summary.byteLength
            );
          }
          if (totalBytes > OFFLINE_SEARCH_MAX_ACCOUNT_BYTES) {
            for (const conversationId of new Set([
              input.activeConversationId,
              ...touchedConversationIds,
            ])) {
              if (totalBytes <= OFFLINE_SEARCH_MAX_ACCOUNT_BYTES) {
                break;
              }
              const docs = await documentsForConversation(
                documentStore,
                conversationId
              );
              const summary = conversationStates.get(conversationId);
              evictFromConversation(
                conversationId,
                docs,
                summary?.byteLength ?? 0
              );
            }
          }
          // oxlint-enable no-await-in-loop

          return {
            evictedMessageIds: [...evicted.values()],
            stored: true,
            totalBytes: Math.max(0, totalBytes),
          };
        }
      );
    } catch {
      return failedWrite("unavailable");
    }
  }

  async function search(input: {
    after?: OfflineSearchCursor;
    before?: OfflineSearchCursor;
    conversationId: string;
    limit?: number;
    query: string;
    scope: OfflineSearchCacheScope;
  }): Promise<OfflineSearchCachePage | null> {
    if (!validScope(input.scope)) {
      return null;
    }
    try {
      return await runTransaction(
        [
          OFFLINE_SEARCH_DOCUMENTS_STORE,
          OFFLINE_SEARCH_PAYLOADS_STORE,
          OFFLINE_SEARCH_STATE_STORE,
          OFFLINE_SEARCH_TOMBSTONES_STORE,
        ],
        "readwrite",
        async (transaction) => {
          const documentStore = transaction.objectStore(
            OFFLINE_SEARCH_DOCUMENTS_STORE
          );
          const payloadStore = transaction.objectStore(
            OFFLINE_SEARCH_PAYLOADS_STORE
          );
          const stateStore = transaction.objectStore(
            OFFLINE_SEARCH_STATE_STORE
          );
          const activeScope = await requestAsPromise(stateStore.get(SCOPE_KEY));
          if (!scopeMatches(activeScope, input.scope)) {
            return null;
          }
          const documents = await documentsForConversation(
            documentStore,
            input.conversationId
          );
          const page = offlineSearchRecords(documents, {
            after: input.after,
            before: input.before,
            limit: input.limit,
            query: input.query,
          });
          const payloadRows = await Promise.all(
            page.hits.map((document) =>
              requestAsPromise(
                payloadStore.get(messageKey(input.conversationId, document.id))
              )
            )
          );
          const missingIds = page.hits
            .filter((_, index) => !payloadRows[index])
            .map((document) => document.id);
          if (missingIds.length > 0) {
            const missing = new Set(missingIds);
            for (const id of missingIds) {
              const key = messageKey(input.conversationId, id);
              documentStore.delete(key);
              payloadStore.delete(key);
            }
            writeConversationState(
              stateStore,
              input.conversationId,
              documents.filter((document) => !missing.has(document.id)),
              Date.now()
            );
            return null;
          }
          const summary = asConversationState(
            await requestAsPromise(
              stateStore.get(conversationStateKey(input.conversationId))
            )
          );
          if (summary) {
            stateStore.put(
              { ...summary, lastAccessedAt: Date.now() },
              summary.id
            );
          }
          return {
            ...page,
            hits: page.hits.map((document, index) =>
              recordFromParts(
                document as OfflineSearchDocument,
                payloadRows[index] as OfflineSearchStoredPayload
              )
            ),
          };
        }
      );
    } catch {
      return null;
    }
  }

  async function getMessages(
    scope: OfflineSearchCacheScope,
    conversationId: string,
    messageIds: readonly string[]
  ): Promise<Map<string, OfflineSearchPayload>> {
    if (!validScope(scope) || messageIds.length === 0) {
      return new Map();
    }
    try {
      return await runTransaction(
        [OFFLINE_SEARCH_PAYLOADS_STORE, OFFLINE_SEARCH_STATE_STORE],
        "readonly",
        async (transaction) => {
          const state = await requestAsPromise(
            transaction.objectStore(OFFLINE_SEARCH_STATE_STORE).get(SCOPE_KEY)
          );
          if (!scopeMatches(state, scope)) {
            return new Map();
          }
          const payloadStore = transaction.objectStore(
            OFFLINE_SEARCH_PAYLOADS_STORE
          );
          const rows = await Promise.all(
            messageIds.map((id) =>
              requestAsPromise(payloadStore.get(messageKey(conversationId, id)))
            )
          );
          const result = new Map<string, OfflineSearchPayload>();
          for (let index = 0; index < messageIds.length; index += 1) {
            const row = rows[index] as OfflineSearchStoredPayload | undefined;
            const messageId = messageIds[index];
            if (row && messageId) {
              result.set(messageId, {
                ciphertext: row.ciphertext,
                iv: row.iv,
                keyEpoch: row.keyEpoch,
                ratchetIndex: row.ratchetIndex,
                senderId: row.senderId,
              });
            }
          }
          return result;
        }
      );
    } catch {
      return new Map();
    }
  }

  async function removeMessages(
    scope: OfflineSearchCacheScope,
    conversationId: string,
    messageIds: readonly string[],
    removals: readonly OfflineSearchCacheRemoval[] = []
  ): Promise<boolean> {
    if (!validScope(scope)) {
      return false;
    }
    try {
      return await runTransaction(
        [
          OFFLINE_SEARCH_DOCUMENTS_STORE,
          OFFLINE_SEARCH_PAYLOADS_STORE,
          OFFLINE_SEARCH_STATE_STORE,
          OFFLINE_SEARCH_TOMBSTONES_STORE,
        ],
        "readwrite",
        async (transaction) => {
          const documentStore = transaction.objectStore(
            OFFLINE_SEARCH_DOCUMENTS_STORE
          );
          const payloadStore = transaction.objectStore(
            OFFLINE_SEARCH_PAYLOADS_STORE
          );
          const stateStore = transaction.objectStore(
            OFFLINE_SEARCH_STATE_STORE
          );
          const tombstoneStore = transaction.objectStore(
            OFFLINE_SEARCH_TOMBSTONES_STORE
          );
          const state = await requestAsPromise(stateStore.get(SCOPE_KEY));
          if (!scopeMatches(state, scope)) {
            return false;
          }
          const removalById = new Map(
            removals.map((removal) => [removal.id, removal])
          );
          const tombstones = await Promise.all(
            messageIds.map((id) =>
              requestAsPromise(
                tombstoneStore.get(tombstoneKey(conversationId, id))
              )
            )
          );
          for (let index = 0; index < messageIds.length; index += 1) {
            const id = messageIds[index];
            if (!id) {
              continue;
            }
            const proposedRemoval = removalById.get(id) ?? {
              id,
              revisionFloor: null,
              sequence: null,
              unavailable: true,
            };
            const removal =
              (proposedRemoval.revisionFloor === null ||
                (Number.isSafeInteger(proposedRemoval.revisionFloor) &&
                  proposedRemoval.revisionFloor >= 0)) &&
              (proposedRemoval.sequence === null ||
                (Number.isSafeInteger(proposedRemoval.sequence) &&
                  proposedRemoval.sequence >= 0)) &&
              (proposedRemoval.unavailable ||
                proposedRemoval.revisionFloor !== null)
                ? proposedRemoval
                : {
                    id,
                    revisionFloor: null,
                    sequence: null,
                    unavailable: true,
                  };
            const prior = tombstones[index] as
              | OfflineSearchTombstone
              | undefined;
            if (
              prior?.sequence !== null &&
              prior?.sequence !== undefined &&
              (removal.sequence === null || removal.sequence < prior.sequence)
            ) {
              continue;
            }
            const key = messageKey(conversationId, id);
            documentStore.delete(key);
            payloadStore.delete(key);
            const tombstone: OfflineSearchTombstone = {
              conversationId,
              id,
              revisionFloor: removal.revisionFloor,
              sequence: removal.sequence,
              unavailable: removal.unavailable,
            };
            tombstoneStore.put(tombstone, tombstoneKey(conversationId, id));
          }
          const remaining = await documentsForConversation(
            documentStore,
            conversationId
          );
          writeConversationState(
            stateStore,
            conversationId,
            remaining,
            Date.now()
          );
          return true;
        }
      );
    } catch {
      return false;
    }
  }

  async function clearConversation(
    scope: OfflineSearchCacheScope,
    conversationId: string
  ): Promise<boolean> {
    if (!validScope(scope)) {
      return false;
    }
    try {
      return await runTransaction(
        [
          OFFLINE_SEARCH_DOCUMENTS_STORE,
          OFFLINE_SEARCH_PAYLOADS_STORE,
          OFFLINE_SEARCH_STATE_STORE,
          OFFLINE_SEARCH_TOMBSTONES_STORE,
        ],
        "readwrite",
        async (transaction) => {
          const documentStore = transaction.objectStore(
            OFFLINE_SEARCH_DOCUMENTS_STORE
          );
          const payloadStore = transaction.objectStore(
            OFFLINE_SEARCH_PAYLOADS_STORE
          );
          const stateStore = transaction.objectStore(
            OFFLINE_SEARCH_STATE_STORE
          );
          const state = await requestAsPromise(stateStore.get(SCOPE_KEY));
          if (!scopeMatches(state, scope)) {
            return false;
          }
          const documents = await documentsForConversation(
            documentStore,
            conversationId
          );
          const tombstones = await tombstonesForConversation(
            transaction.objectStore(OFFLINE_SEARCH_TOMBSTONES_STORE),
            conversationId
          );
          for (const document of documents) {
            const key = messageKey(conversationId, document.id);
            documentStore.delete(key);
            payloadStore.delete(key);
          }
          const tombstoneStore = transaction.objectStore(
            OFFLINE_SEARCH_TOMBSTONES_STORE
          );
          for (const tombstone of tombstones) {
            tombstoneStore.delete(tombstoneKey(conversationId, tombstone.id));
          }
          stateStore.delete(conversationStateKey(conversationId));
          return true;
        }
      );
    } catch {
      return false;
    }
  }

  async function clearScope(scope: OfflineSearchCacheScope): Promise<boolean> {
    if (!validScope(scope)) {
      return false;
    }
    try {
      return await runTransaction(
        [
          OFFLINE_SEARCH_DOCUMENTS_STORE,
          OFFLINE_SEARCH_PAYLOADS_STORE,
          OFFLINE_SEARCH_STATE_STORE,
          OFFLINE_SEARCH_TOMBSTONES_STORE,
        ],
        "readwrite",
        async (transaction) => {
          const state = transaction.objectStore(OFFLINE_SEARCH_STATE_STORE);
          const activeScope = await requestAsPromise(state.get(SCOPE_KEY));
          if (!scopeMatches(activeScope, scope)) {
            return false;
          }
          transaction.objectStore(OFFLINE_SEARCH_DOCUMENTS_STORE).clear();
          transaction.objectStore(OFFLINE_SEARCH_PAYLOADS_STORE).clear();
          transaction.objectStore(OFFLINE_SEARCH_TOMBSTONES_STORE).clear();
          state.clear();
          return true;
        }
      );
    } catch {
      return false;
    }
  }

  return {
    activateScope,
    clearConversation,
    clearScope,
    getMessages,
    putBatch,
    removeMessages,
    search,
  };
}

export function resetIndexedDbOfflineSearchCacheStoreForTests(): void {
  void closeCachedDatabase();
  dbPromise = null;
  staleConnection = false;
}

async function closeCachedDatabase(): Promise<void> {
  try {
    const db = await dbPromise;
    db?.close();
  } catch {
    // The cached connection may have failed to open.
  }
}
