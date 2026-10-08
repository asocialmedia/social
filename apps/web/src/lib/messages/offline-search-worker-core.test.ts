// oxlint-disable promise/avoid-new
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "bun:test";

import { encryptMessage, importRatchetBaseKey } from "@asm/messages/crypto";

import {
  createIndexedDbOfflineSearchCacheStore,
  resetIndexedDbOfflineSearchCacheStoreForTests,
} from "./indexeddb-offline-search-cache";
import type { OfflineSearchCacheScope } from "./indexeddb-offline-search-cache";
import { MESSAGES_DB_NAME } from "./message-db";
import { createOfflineSearchWorkerProcessor } from "./offline-search-worker-core";
import type { OfflineSearchWorkerMessage } from "./offline-search-worker-core";

const scope: OfflineSearchCacheScope = {
  recoveryGeneration: 2,
  userId: "user-worker-test",
};

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

function workerMessage(
  index: number,
  ciphertext: string
): OfflineSearchWorkerMessage {
  return {
    message: {
      ciphertext,
      conversationId: "conversation-worker-test",
      createdAt: index + 1,
      id: `message-${index}`,
      iv: `iv-${index}`,
      keyEpoch: 1,
      ratchetIndex: index,
      revision: 1,
      senderId: "sender-worker-test",
    },
    payload: { content: `worker marker ${index}`, type: "text" },
  };
}

describe("offline search worker processor", () => {
  beforeEach(async () => {
    resetIndexedDbOfflineSearchCacheStoreForTests();
    await Promise.resolve();
    await deleteDatabase();
  });

  test("indexes in bounded batches, yields between writes, and returns exact local matches", async () => {
    const cache = createIndexedDbOfflineSearchCacheStore();
    let yields = 0;
    const processor = createOfflineSearchWorkerProcessor({
      cache,
      yieldBetweenBatches: () => {
        yields += 1;
      },
    });
    const activated = await processor.handle({
      requestId: 1,
      scope,
      type: "activate",
    });
    expect(activated.success).toBe(true);

    const messages = Array.from({ length: 5 }, (_, index) =>
      workerMessage(index, "c".repeat(140_000))
    );
    const response = await processor.handle({
      activeConversationId: "conversation-worker-test",
      messages,
      requestId: 2,
      scope,
      type: "index",
    });
    expect(response).toMatchObject({
      indexed: 5,
      requestId: 2,
      skipped: 0,
      success: true,
    });
    expect(yields).toBe(4);

    const page = await processor.handle({
      conversationId: "conversation-worker-test",
      query: "marker",
      requestId: 3,
      scope,
      type: "search",
    });
    expect(page.page?.totalMatches).toBe(5);
    expect(page.page?.hits[0]?.id).toBe("message-4");
  });

  test("refuses delayed writes from an old scope after a recovery generation change", async () => {
    const cache = createIndexedDbOfflineSearchCacheStore();
    const processor = createOfflineSearchWorkerProcessor({ cache });
    await processor.handle({ requestId: 1, scope, type: "activate" });
    const newerScope = { ...scope, recoveryGeneration: 3 };
    await processor.handle({
      requestId: 2,
      scope: newerScope,
      type: "activate",
    });

    const response = await processor.handle({
      activeConversationId: "conversation-worker-test",
      messages: [workerMessage(1, "ciphertext")],
      requestId: 3,
      scope,
      type: "index",
    });
    expect(response).toMatchObject({
      error: "scope-mismatch",
      indexed: 0,
      success: false,
    });
    const page = await processor.handle({
      conversationId: "conversation-worker-test",
      query: "marker",
      requestId: 4,
      scope: newerScope,
      type: "search",
    });
    expect(page.page?.totalMatches).toBe(0);
  });

  test("can purge a persisted account cache after worker memory has restarted", async () => {
    const cache = createIndexedDbOfflineSearchCacheStore();
    expect(await cache.activateScope(scope)).toBe(true);
    const processor = createOfflineSearchWorkerProcessor({ cache });
    const response = await processor.handle({
      requestId: 1,
      scope,
      type: "clear-scope",
    });

    expect(response.success).toBe(true);
    expect(
      await cache.search({
        conversationId: "conversation-worker-test",
        query: "marker",
        scope,
      })
    ).toBeNull();
  });

  test("decrypts in the worker and reports an authenticated failure without returning plaintext", async () => {
    const cache = createIndexedDbOfflineSearchCacheStore();
    const processor = createOfflineSearchWorkerProcessor({ cache });
    const rootKey = crypto.getRandomValues(new Uint8Array(32));
    const baseKey = await importRatchetBaseKey(rootKey);
    const encrypted = await encryptMessage(
      rootKey,
      "sender-worker-test",
      17,
      "conversation-worker-test",
      { content: "worker decrypted payload", type: "text" }
    );
    const item = {
      conversationId: "conversation-worker-test",
      message: {
        ...encrypted,
        id: "message-decrypt",
        ratchetIndex: 17,
        senderId: "sender-worker-test",
      },
    };
    const result = await processor.handle({
      baseKey,
      item,
      requestId: 1,
      type: "decrypt",
    });
    expect(result).toMatchObject({
      decryptResult: "decrypted",
      payload: { content: "worker decrypted payload", type: "text" },
      success: true,
    });

    const failed = await processor.handle({
      baseKey,
      item: {
        ...item,
        conversationId: "wrong-conversation",
      },
      requestId: 2,
      type: "decrypt",
    });
    expect(failed).toMatchObject({ decryptResult: "failed", success: false });
    expect(failed).not.toHaveProperty("payload");
  });
});
