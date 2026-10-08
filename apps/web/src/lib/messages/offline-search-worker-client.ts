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
import type { OfflineSearchCursor } from "./offline-search-cache";
import type {
  OfflineSearchWorkerDecryptItem,
  OfflineSearchWorkerMessage,
  OfflineSearchWorkerRequest,
  OfflineSearchWorkerResponse,
} from "./offline-search-worker-core";

const MAX_PENDING_WORKER_REQUESTS = 16;
const WORKER_REQUEST_TIMEOUT_MS = 30_000;

type OfflineSearchWorkerPort = Pick<
  Worker,
  "addEventListener" | "postMessage" | "removeEventListener" | "terminate"
>;

interface PendingWorkerRequest {
  resolve: (response: OfflineSearchWorkerResponse | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type OfflineSearchWorkerRequestInput =
  OfflineSearchWorkerRequest extends infer Request
    ? Request extends { requestId: number }
      ? Omit<Request, "requestId">
      : never
    : never;

function postWorkerMessage(
  worker: OfflineSearchWorkerPort,
  message: OfflineSearchWorkerRequest
): void {
  const postMessage = worker.postMessage.bind(worker);
  postMessage(message);
}

export interface OfflineSearchWorkerClient {
  activateScope: (scope: OfflineSearchCacheScope) => Promise<boolean>;
  clearConversation: (
    scope: OfflineSearchCacheScope,
    conversationId: string
  ) => Promise<boolean>;
  clearScope: (scope: OfflineSearchCacheScope) => Promise<boolean>;
  dispose: () => void;
  decrypt: (
    item: OfflineSearchWorkerDecryptItem,
    baseKey: CryptoKey
  ) => Promise<
    | { payload: MessagePayload; status: "decrypted" }
    | { status: "failed" | "unavailable" }
  >;
  index: (input: {
    activeConversationId: string;
    messages: readonly OfflineSearchWorkerMessage[];
    scope: OfflineSearchCacheScope;
  }) => Promise<{ indexed: number; skipped: number; success: boolean }>;
  remove: (
    scope: OfflineSearchCacheScope,
    conversationId: string,
    messageIds: readonly string[],
    removals?: readonly OfflineSearchCacheRemoval[]
  ) => Promise<boolean>;
  search: (input: {
    before?: OfflineSearchCursor;
    conversationId: string;
    limit?: number;
    query: string;
    scope: OfflineSearchCacheScope;
  }) => Promise<
    Awaited<ReturnType<IndexedDbOfflineSearchCacheStore["search"]>>
  >;
}

function inputMessageBytes(message: OfflineSearchWorkerMessage): number {
  const content = message.payload.content ?? "";
  let mediaLength = 0;
  if (message.payload.type === "media") {
    mediaLength =
      "images" in message.payload
        ? message.payload.images.reduce(
            (sum, image) => sum + image.url.length,
            0
          )
        : message.payload.url.length;
  }
  const encodedCharacterCount =
    message.message.ciphertext.length +
    message.message.iv.length +
    content.length +
    mediaLength;
  return encodedCharacterCount * 4 + 1024;
}

function createBrowserWorker(): OfflineSearchWorkerPort | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  try {
    return new Worker(
      new URL("offline-search-cache.worker.ts", import.meta.url),
      {
        type: "module",
      }
    );
  } catch {
    return null;
  }
}

export function createOfflineSearchWorkerClient(input?: {
  createWorker?: () => OfflineSearchWorkerPort | null;
  requestTimeoutMs?: number;
}): OfflineSearchWorkerClient {
  const createWorker = input?.createWorker ?? createBrowserWorker;
  const requestTimeoutMs = Math.max(
    1,
    input?.requestTimeoutMs ?? WORKER_REQUEST_TIMEOUT_MS
  );
  let worker: OfflineSearchWorkerPort | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingWorkerRequest>();
  let messageListener:
    | ((event: MessageEvent<OfflineSearchWorkerResponse>) => void)
    | null = null;
  let errorListener: ((event: ErrorEvent) => void) | null = null;

  function settlePending(response: OfflineSearchWorkerResponse | null): void {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.resolve(response);
    }
    pending.clear();
  }

  function closeWorker(): void {
    if (worker && messageListener && errorListener) {
      worker.removeEventListener("message", messageListener);
      worker.removeEventListener("error", errorListener);
      worker.terminate();
    }
    worker = null;
    messageListener = null;
    errorListener = null;
  }

  function failWorker(): void {
    closeWorker();
    settlePending(null);
  }

  function ensureWorker(): OfflineSearchWorkerPort | null {
    if (worker) {
      return worker;
    }
    try {
      worker = createWorker();
    } catch {
      worker = null;
    }
    if (!worker) {
      return null;
    }
    messageListener = (event) => {
      const response = event.data;
      const request = pending.get(response.requestId);
      if (!request) {
        return;
      }
      clearTimeout(request.timeout);
      pending.delete(response.requestId);
      request.resolve(response);
    };
    errorListener = () => failWorker();
    worker.addEventListener("message", messageListener);
    worker.addEventListener("error", errorListener);
    return worker;
  }

  function send(
    request: OfflineSearchWorkerRequestInput
  ): Promise<OfflineSearchWorkerResponse | null> {
    const activeWorker = ensureWorker();
    if (!activeWorker || pending.size >= MAX_PENDING_WORKER_REQUESTS) {
      return Promise.resolve(null);
    }
    const requestId = nextRequestId;
    nextRequestId += 1;
    const message = { ...request, requestId } as OfflineSearchWorkerRequest;
    // oxlint-disable-next-line promise/avoid-new -- worker responses arrive through postMessage events
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        resolve(null);
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, timeout });
      try {
        postWorkerMessage(activeWorker, message);
      } catch {
        clearTimeout(timeout);
        pending.delete(requestId);
        resolve(null);
        failWorker();
      }
    });
  }

  async function index(batchInput: {
    activeConversationId: string;
    messages: readonly OfflineSearchWorkerMessage[];
    scope: OfflineSearchCacheScope;
  }): Promise<{ indexed: number; skipped: number; success: boolean }> {
    let indexed = 0;
    let skipped = 0;
    const batches: OfflineSearchWorkerMessage[][] = [];
    let batch: OfflineSearchWorkerMessage[] = [];
    let batchBytes = 0;
    for (const message of batchInput.messages) {
      const bytes = inputMessageBytes(message);
      if (bytes > OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES) {
        skipped += 1;
        continue;
      }
      if (
        batch.length >= OFFLINE_SEARCH_MAX_WRITE_BATCH_MESSAGES ||
        batchBytes + bytes > OFFLINE_SEARCH_MAX_WRITE_BATCH_BYTES
      ) {
        batches.push(batch);
        batch = [];
        batchBytes = 0;
      }
      batch.push(message);
      batchBytes += bytes;
    }
    if (batch.length > 0) {
      batches.push(batch);
    }

    // oxlint-disable no-await-in-loop -- each persisted batch must settle before worker backpressure is released
    for (const messages of batches) {
      const response = await send({
        activeConversationId: batchInput.activeConversationId,
        messages,
        scope: batchInput.scope,
        type: "index",
      });
      if (response?.type !== "index" || !response.success) {
        return {
          indexed,
          skipped: batchInput.messages.length - indexed,
          success: false,
        };
      }
      indexed += response.indexed ?? 0;
      skipped += response.skipped ?? 0;
    }
    // oxlint-enable no-await-in-loop
    return { indexed, skipped, success: true };
  }

  return {
    async activateScope(scope) {
      const response = await send({ scope, type: "activate" });
      return response?.type === "activate" && response.success;
    },
    async clearConversation(scope, conversationId) {
      const response = await send({
        conversationId,
        scope,
        type: "clear-conversation",
      });
      return response?.type === "clear-conversation" && response.success;
    },
    async clearScope(scope) {
      const response = await send({ scope, type: "clear-scope" });
      return response?.type === "clear-scope" && response.success;
    },
    async decrypt(item, baseKey) {
      const response = await send({ baseKey, item, type: "decrypt" });
      if (response?.type !== "decrypt") {
        return { status: "unavailable" };
      }
      if (
        response.decryptResult === "decrypted" &&
        response.payload !== undefined
      ) {
        return { payload: response.payload, status: "decrypted" };
      }
      if (response.error === "unavailable") {
        return { status: "unavailable" };
      }
      return { status: "failed" };
    },
    dispose() {
      closeWorker();
      settlePending(null);
    },
    index,
    async remove(scope, conversationId, messageIds, removals) {
      const response = await send({
        conversationId,
        messageIds,
        ...(removals ? { removals } : {}),
        scope,
        type: "remove",
      });
      return response?.type === "remove" && response.success;
    },
    async search(searchRequest) {
      const response = await send({ ...searchRequest, type: "search" });
      return response?.type === "search" && response.success
        ? (response.page ?? null)
        : null;
    },
  };
}

export const offlineSearchWorkerClient = createOfflineSearchWorkerClient();
