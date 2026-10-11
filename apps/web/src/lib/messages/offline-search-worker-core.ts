import { decryptMessageWithBaseKey } from "@asm/messages/crypto";
import type { MessagePayload } from "@asm/messages/crypto";

import type {
  IndexedDbOfflineSearchCacheStore,
  OfflineSearchCacheRemoval,
  OfflineSearchCacheScope,
} from "./indexeddb-offline-search-cache";
import {
  OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES,
  OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES,
} from "./indexeddb-offline-search-cache";
import {
  buildOfflineSearchCacheRecord,
  estimateOfflineSearchRecordBytes,
} from "./offline-search-cache";
import type {
  OfflineSearchCacheRecord,
  OfflineSearchCursor,
  OfflineSearchSourceMessage,
} from "./offline-search-cache";

export interface OfflineSearchWorkerMessage {
  message: OfflineSearchSourceMessage;
  payload: MessagePayload;
}

export interface OfflineSearchWorkerDecryptItem {
  conversationId: string;
  message: {
    ciphertext: string;
    id: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  };
}

export type OfflineSearchWorkerRequest =
  | {
      baseKey: CryptoKey;
      item: OfflineSearchWorkerDecryptItem;
      requestId: number;
      type: "decrypt";
    }
  | {
      requestId: number;
      scope: OfflineSearchCacheScope;
      type: "activate";
    }
  | {
      activeConversationId: string;
      messages: readonly OfflineSearchWorkerMessage[];
      requestId: number;
      scope: OfflineSearchCacheScope;
      type: "index";
    }
  | {
      conversationId: string;
      messageIds: readonly string[];
      removals?: readonly OfflineSearchCacheRemoval[];
      requestId: number;
      scope: OfflineSearchCacheScope;
      type: "remove";
    }
  | {
      after?: OfflineSearchCursor;
      before?: OfflineSearchCursor;
      conversationId: string;
      limit?: number;
      query: string;
      requestId: number;
      scope: OfflineSearchCacheScope;
      type: "search";
    }
  | {
      conversationId: string;
      requestId: number;
      scope: OfflineSearchCacheScope;
      type: "clear-conversation";
    }
  | {
      requestId: number;
      scope: OfflineSearchCacheScope;
      type: "clear-scope";
    };

export interface OfflineSearchWorkerResponse {
  decryptResult?: "decrypted" | "failed";
  error?: "scope-mismatch" | "unavailable";
  indexed?: number;
  page?: Awaited<ReturnType<IndexedDbOfflineSearchCacheStore["search"]>>;
  payload?: MessagePayload;
  requestId: number;
  skipped?: number;
  success: boolean;
  type: OfflineSearchWorkerRequest["type"];
}

export interface OfflineSearchWorkerProcessor {
  handle: (
    request: OfflineSearchWorkerRequest
  ) => Promise<OfflineSearchWorkerResponse>;
}

function yieldToWorker(): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- the worker yields through its task queue between bounded batches
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function sameScope(
  left: OfflineSearchCacheScope | null,
  right: OfflineSearchCacheScope
): boolean {
  return (
    left !== null &&
    left.userId === right.userId &&
    left.recoveryGeneration === right.recoveryGeneration
  );
}

function validWorkerMessage(message: OfflineSearchWorkerMessage): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof message.message === "object" &&
    message.message !== null &&
    typeof message.payload === "object" &&
    message.payload !== null
  );
}

export function createOfflineSearchWorkerProcessor(input: {
  cache: IndexedDbOfflineSearchCacheStore;
  decrypt?: (
    item: OfflineSearchWorkerDecryptItem,
    baseKey: CryptoKey
  ) => Promise<MessagePayload>;
  yieldBetweenBatches?: () => Promise<void>;
}): OfflineSearchWorkerProcessor {
  let activeScope: OfflineSearchCacheScope | null = null;
  const decrypt =
    input.decrypt ??
    ((item, baseKey) =>
      decryptMessageWithBaseKey(
        baseKey,
        item.message.senderId,
        item.conversationId,
        item.message
      ));
  const yieldBetweenBatches = input.yieldBetweenBatches ?? yieldToWorker;

  async function indexBatch(
    request: Extract<OfflineSearchWorkerRequest, { type: "index" }>
  ): Promise<{
    indexed: number;
    skipped: number;
    success: boolean;
  }> {
    if (!sameScope(activeScope, request.scope)) {
      return { indexed: 0, skipped: request.messages.length, success: false };
    }
    let indexed = 0;
    let skipped = 0;
    let pending: OfflineSearchCacheRecord[] = [];
    let pendingBytes = 0;
    const batches: OfflineSearchCacheRecord[][] = [];
    for (const message of request.messages) {
      if (!validWorkerMessage(message)) {
        skipped += 1;
        continue;
      }
      const record = buildOfflineSearchCacheRecord(message);
      if (!record) {
        skipped += 1;
        continue;
      }
      const bytes = estimateOfflineSearchRecordBytes(record);
      if (bytes > OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES) {
        skipped += 1;
        continue;
      }
      if (
        pending.length >= OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES ||
        pendingBytes + bytes > OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES
      ) {
        batches.push(pending);
        pending = [];
        pendingBytes = 0;
      }
      pending.push(record);
      pendingBytes += bytes;
    }
    if (pending.length > 0) {
      batches.push(pending);
    }

    // oxlint-disable no-await-in-loop -- cache transactions and yields must honor bounded worker backpressure
    for (let index = 0; index < batches.length; index += 1) {
      if (!sameScope(activeScope, request.scope)) {
        return {
          indexed,
          skipped: request.messages.length - indexed,
          success: false,
        };
      }
      const result = await input.cache.putBatch({
        activeConversationId: request.activeConversationId,
        records: batches[index] ?? [],
        scope: request.scope,
      });
      if (!result.stored) {
        return { indexed, skipped, success: false };
      }
      indexed += batches[index]?.length ?? 0;
      if (index + 1 < batches.length) {
        await yieldBetweenBatches();
      }
    }
    // oxlint-enable no-await-in-loop
    return { indexed, skipped, success: true };
  }

  return {
    async handle(request) {
      if (request.type === "decrypt") {
        try {
          const payload = await decrypt(request.item, request.baseKey);
          return {
            decryptResult: "decrypted",
            payload,
            requestId: request.requestId,
            success: true,
            type: request.type,
          };
        } catch {
          return {
            decryptResult: "failed",
            requestId: request.requestId,
            success: false,
            type: request.type,
          };
        }
      }
      if (request.type === "activate") {
        const success = await input.cache.activateScope(request.scope);
        activeScope = success ? request.scope : null;
        return {
          requestId: request.requestId,
          success,
          type: request.type,
          ...(success ? {} : { error: "unavailable" as const }),
        };
      }
      if (
        !sameScope(activeScope, request.scope) &&
        request.type !== "clear-scope"
      ) {
        return {
          error: "scope-mismatch",
          requestId: request.requestId,
          success: false,
          type: request.type,
          ...(request.type === "index"
            ? { indexed: 0, skipped: request.messages.length }
            : {}),
        };
      }
      try {
        if (request.type === "index") {
          const result = await indexBatch(request);
          const response = {
            indexed: result.indexed,
            requestId: request.requestId,
            skipped: result.skipped,
            success: result.success,
            type: request.type,
          };
          if (result.success) {
            return response;
          }
          return { ...response, error: "unavailable" as const };
        }
        if (request.type === "search") {
          const page = await input.cache.search({
            after: request.after,
            before: request.before,
            conversationId: request.conversationId,
            limit: request.limit,
            query: request.query,
            scope: request.scope,
          });
          return {
            ...(page === null ? { error: "unavailable" as const } : { page }),
            requestId: request.requestId,
            success: page !== null,
            type: request.type,
          };
        }
        let success: boolean;
        if (request.type === "remove") {
          success = await input.cache.removeMessages(
            request.scope,
            request.conversationId,
            request.messageIds,
            request.removals
          );
        } else if (request.type === "clear-conversation") {
          success = await input.cache.clearConversation(
            request.scope,
            request.conversationId
          );
        } else {
          success = await input.cache.clearScope(request.scope);
        }
        if (
          request.type === "clear-scope" &&
          success &&
          sameScope(activeScope, request.scope)
        ) {
          activeScope = null;
        }
        return {
          ...(success ? {} : { error: "unavailable" as const }),
          requestId: request.requestId,
          success,
          type: request.type,
        };
      } catch {
        return {
          error: "unavailable",
          requestId: request.requestId,
          success: false,
          type: request.type,
          ...(request.type === "index"
            ? { indexed: 0, skipped: request.messages.length }
            : {}),
        };
      }
    },
  };
}
