// oxlint-disable promise/avoid-new
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  createIndexedDbOfflineSearchCacheStore,
  OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES,
  resetIndexedDbOfflineSearchCacheStoreForTests,
} from "./indexeddb-offline-search-cache";
import type {
  OfflineSearchCacheRecord,
  OfflineSearchCacheScope,
} from "./indexeddb-offline-search-cache";
import {
  IDENTITY_STORE,
  MESSAGES_DB_NAME,
  MESSAGES_DB_VERSION,
  OFFLINE_SEARCH_DOCUMENTS_STORE,
  OFFLINE_SEARCH_PAYLOADS_STORE,
  OFFLINE_SEARCH_STATE_STORE,
} from "./message-db";
import {
  buildOfflineSearchCacheRecord,
  OFFLINE_SEARCH_MAX_ACCOUNT_BYTES,
} from "./offline-search-cache";

const scope: OfflineSearchCacheScope = {
  recoveryGeneration: 0,
  userId: "user-a",
};

function record(input: {
  conversationId?: string;
  createdAt?: number;
  id: string;
  revision?: number;
  text?: string;
  ciphertext?: string;
}): OfflineSearchCacheRecord {
  const createdAt =
    input.createdAt ?? Number(input.id.replaceAll(/\D/g, "") || 1);
  const result = buildOfflineSearchCacheRecord({
    cachedAt: createdAt,
    message: {
      ciphertext: input.ciphertext ?? `cipher-${input.id}`,
      conversationId: input.conversationId ?? "conversation-a",
      createdAt,
      id: input.id,
      iv: `iv-${input.id}`,
      keyEpoch: 0,
      ratchetIndex: createdAt,
      revision: input.revision ?? 1,
      senderId: "user-a",
    },
    payload: {
      content: input.text ?? `offline needle ${input.id}`,
      type: "text",
    },
  });
  if (!result) {
    throw new Error("expected a valid offline cache record");
  }
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MESSAGES_DB_NAME, MESSAGES_DB_VERSION);
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(MESSAGES_DB_NAME);
    request.addEventListener("success", () => {
      resolve();
    });
    request.addEventListener("error", () => {
      resolve();
    });
    request.addEventListener("blocked", () => {
      resolve();
    });
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
}

describe("IndexedDB offline search cache", () => {
  beforeEach(async () => {
    resetIndexedDbOfflineSearchCacheStoreForTests();
    await Promise.resolve();
    await deleteDatabase();
  });

  test("stores searchable terms separately from ciphertext and hydrates only hits", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    expect(await store.activateScope(scope)).toBe(true);
    const row = record({
      id: "message-1",
      text: "Café URL https://example.test/path Ελληνικά",
    });
    expect(
      await store.putBatch({
        activeConversationId: "conversation-a",
        records: [row],
        scope,
      })
    ).toMatchObject({ stored: true, totalBytes: expect.any(Number) });

    const page = await store.search({
      conversationId: "conversation-a",
      query: "cafe",
      scope,
    });
    expect(page?.hits.map(({ id }) => id)).toEqual(["message-1"]);
    expect(page?.hits[0]?.ciphertext).toBe("cipher-message-1");
    expect(page?.hits[0]?.terms).toContain("ελληνικα");

    const db = await openDatabase();
    const transaction = db.transaction(
      [OFFLINE_SEARCH_DOCUMENTS_STORE, OFFLINE_SEARCH_PAYLOADS_STORE],
      "readonly"
    );
    const documentRequest = transaction
      .objectStore(OFFLINE_SEARCH_DOCUMENTS_STORE)
      .get(JSON.stringify(["conversation-a", "message-1"]));
    const payloadRequest = transaction
      .objectStore(OFFLINE_SEARCH_PAYLOADS_STORE)
      .get(JSON.stringify(["conversation-a", "message-1"]));
    const [document, payload] = await Promise.all([
      requestResult(documentRequest),
      requestResult(payloadRequest),
    ]);
    db.close();
    expect(document).toMatchObject({ revision: 1, terms: expect.any(Array) });
    expect(document).not.toHaveProperty("ciphertext");
    expect(document).not.toHaveProperty("content");
    expect(payload).toMatchObject({ ciphertext: "cipher-message-1" });
  });

  test("clears derived cache on account or recovery generation changes and preserves identity", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    expect(await store.activateScope(scope)).toBe(true);
    await store.putBatch({
      activeConversationId: "conversation-a",
      records: [record({ id: "message-1" })],
      scope,
    });

    const db = await openDatabase();
    const seed = db.transaction(IDENTITY_STORE, "readwrite");
    seed.objectStore(IDENTITY_STORE).put({ privateKey: "identity" }, "user-a");
    await new Promise<void>((resolve) => {
      seed.addEventListener("complete", () => {
        resolve();
      });
    });
    db.close();

    const nextScope = { recoveryGeneration: 1, userId: "user-a" };
    expect(await store.activateScope(nextScope)).toBe(true);
    expect(
      await store.search({
        conversationId: "conversation-a",
        query: "needle",
        scope: nextScope,
      })
    ).toMatchObject({ hits: [], totalMatches: 0 });

    const verify = await openDatabase();
    const tx = verify.transaction(
      [
        IDENTITY_STORE,
        OFFLINE_SEARCH_DOCUMENTS_STORE,
        OFFLINE_SEARCH_STATE_STORE,
      ],
      "readonly"
    );
    const identityRequest = tx.objectStore(IDENTITY_STORE).get("user-a");
    const documentsRequest = tx
      .objectStore(OFFLINE_SEARCH_DOCUMENTS_STORE)
      .count();
    const stateRequest = tx
      .objectStore(OFFLINE_SEARCH_STATE_STORE)
      .get("active-scope");
    const values = await Promise.all([
      requestResult(identityRequest),
      requestResult(documentsRequest),
      requestResult(stateRequest),
    ]);
    verify.close();
    expect(values[0]).toEqual({ privateKey: "identity" });
    expect(values[1]).toBe(0);
    expect(values[2]).toMatchObject(nextScope);
  });

  test("rejects stale revisions, paginates newest first, and removes hidden or deleted rows", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    await store.activateScope(scope);
    const records = [
      record({
        createdAt: 100,
        id: "message-a",
        revision: 2,
        text: "needle newer",
      }),
      record({ createdAt: 100, id: "message-b", text: "needle same time" }),
      record({ createdAt: 90, id: "message-c", text: "needle oldest" }),
    ];
    await store.putBatch({
      activeConversationId: "conversation-a",
      records,
      scope,
    });
    const stale = record({
      createdAt: 100,
      id: "message-a",
      revision: 1,
      text: "needle stale revision",
    });
    await store.putBatch({
      activeConversationId: "conversation-a",
      records: [stale],
      scope,
    });

    const first = await store.search({
      conversationId: "conversation-a",
      limit: 2,
      query: "needle",
      scope,
    });
    expect(first?.hits.map(({ id }) => id)).toEqual(["message-b", "message-a"]);
    expect(first?.hits[1]?.revision).toBe(2);
    expect(first?.hasMore).toBe(true);
    const second = await store.search({
      before: first?.nextCursor ?? undefined,
      conversationId: "conversation-a",
      query: "needle",
      scope,
    });
    expect(second?.hits.map(({ id }) => id)).toEqual(["message-c"]);
    expect(
      await store.removeMessages(scope, "conversation-a", ["message-a"])
    ).toBe(true);
    const afterRemoval = await store.search({
      conversationId: "conversation-a",
      query: "needle",
      scope,
    });
    expect(afterRemoval?.hits.map(({ id }) => id)).toEqual([
      "message-b",
      "message-c",
    ]);
    expect(await store.clearConversation(scope, "conversation-a")).toBe(true);
    expect(
      await store.search({
        conversationId: "conversation-a",
        query: "needle",
        scope,
      })
    ).toMatchObject({ hits: [], totalMatches: 0 });
  });

  test("enforces worker batch limits and refuses writes from a stale account scope", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    await store.activateScope(scope);
    const tooMany = Array.from(
      { length: OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES + 1 },
      (_, index) => record({ id: `message-${index}` })
    );
    expect(
      await store.putBatch({
        activeConversationId: "conversation-a",
        records: tooMany,
        scope,
      })
    ).toMatchObject({ reason: "batch-limit", stored: false });

    const nextScope = { recoveryGeneration: 0, userId: "user-b" };
    await store.activateScope(nextScope);
    expect(
      await store.putBatch({
        activeConversationId: "conversation-a",
        records: [record({ id: "old-account-message" })],
        scope,
      })
    ).toMatchObject({ reason: "scope-mismatch", stored: false });
  });

  test("caps each conversation at the newest 1,000 cached messages", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    await store.activateScope(scope);
    const messages = Array.from({ length: 1001 }, (_, index) =>
      record({
        createdAt: index + 1,
        id: `message-${String(index).padStart(4, "0")}`,
        text: "bounded cache marker",
      })
    );
    // oxlint-disable no-await-in-loop -- each write tests the persisted rolling cap
    for (let index = 0; index < messages.length; index += 32) {
      await store.putBatch({
        activeConversationId: "conversation-a",
        records: messages.slice(index, index + 32),
        scope,
      });
    }
    // oxlint-enable no-await-in-loop

    const page = await store.search({
      conversationId: "conversation-a",
      limit: 20,
      query: "marker",
      scope,
    });
    expect(page?.totalMatches).toBe(1000);
    expect(page?.hits[0]?.id).toBe("message-1000");
    expect(page?.hits.some(({ id }) => id === "message-0000")).toBe(false);
  });

  test("keeps the serialized account cache within 32 MiB under large ciphertext writes", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    await store.activateScope(scope);
    const largeCiphertext = "x".repeat(250_000);
    let result = { stored: true, totalBytes: 0 };
    // oxlint-disable no-await-in-loop -- each write verifies the committed account byte cap
    for (let index = 0; index < 125; index += 1) {
      result = await store.putBatch({
        activeConversationId: "conversation-old",
        records: [
          record({
            ciphertext: largeCiphertext,
            conversationId: "conversation-old",
            createdAt: index + 1,
            id: `old-${index}`,
            text: "large cache row",
          }),
        ],
        scope,
      });
    }
    for (let index = 0; index < 15; index += 1) {
      result = await store.putBatch({
        activeConversationId: "conversation-a",
        records: [
          record({
            ciphertext: largeCiphertext,
            createdAt: index + 126,
            id: `large-${index}`,
            text: "large cache row",
          }),
        ],
        scope,
      });
    }
    // oxlint-enable no-await-in-loop

    expect(result.stored).toBe(true);
    expect(result.totalBytes).toBeLessThanOrEqual(
      OFFLINE_SEARCH_MAX_ACCOUNT_BYTES
    );
    const page = await store.search({
      conversationId: "conversation-a",
      limit: 20,
      query: "cache row",
      scope,
    });
    expect(page?.hits[0]?.id).toBe("large-14");
    expect(page?.totalMatches).toBe(15);
    const oldPage = await store.search({
      conversationId: "conversation-old",
      query: "cache row",
      scope,
    });
    expect(oldPage?.totalMatches).toBeLessThan(125);
  });

  test("treats a missing active scope as an unavailable offline search", async () => {
    const store = createIndexedDbOfflineSearchCacheStore();
    expect(
      await store.search({
        conversationId: "conversation-a",
        query: "needle",
        scope,
      })
    ).toBeNull();
    expect(await store.activateScope(scope)).toBe(true);
    expect(await store.clearScope(scope)).toBe(true);
  });
});
