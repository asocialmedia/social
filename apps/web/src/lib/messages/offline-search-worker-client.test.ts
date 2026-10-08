import { describe, expect, test } from "bun:test";

import { createOfflineSearchWorkerClient } from "./offline-search-worker-client";
import type { OfflineSearchWorkerClient } from "./offline-search-worker-client";
import type {
  OfflineSearchWorkerRequest,
  OfflineSearchWorkerResponse,
} from "./offline-search-worker-core";

const scope = { recoveryGeneration: 2, userId: "user-1" };

type MessageListener = (
  event: MessageEvent<OfflineSearchWorkerResponse>
) => void;
type ErrorListener = (event: ErrorEvent) => void;

class TestWorker {
  readonly posted: OfflineSearchWorkerRequest[] = [];
  respondToMessages = true;
  terminated = false;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(type: "error", listener: ErrorListener): void;
  addEventListener(
    type: "message" | "error",
    listener: MessageListener | ErrorListener
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as MessageListener);
    } else {
      this.errorListeners.add(listener as ErrorListener);
    }
  }

  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "error", listener: ErrorListener): void;
  removeEventListener(
    type: "message" | "error",
    listener: MessageListener | ErrorListener
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as MessageListener);
    } else {
      this.errorListeners.delete(listener as ErrorListener);
    }
  }

  postMessage(message: OfflineSearchWorkerRequest): void {
    this.posted.push(message);
    if (!this.respondToMessages) {
      return;
    }
    if (message.type === "activate") {
      this.respond(message, { success: true });
    } else if (message.type === "index") {
      this.respond(message, {
        indexed: message.messages.length,
        skipped: 0,
        success: true,
      });
    } else if (message.type === "search") {
      this.respond(message, {
        page: {
          hasMore: false,
          hits: [],
          nextCursor: null,
          totalMatches: 0,
        },
        success: true,
      });
    } else {
      this.respond(message, { success: true });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(): void {
    const event = new ErrorEvent("error");
    for (const listener of this.errorListeners) {
      listener(event);
    }
  }

  private respond(
    request: OfflineSearchWorkerRequest,
    body: Omit<OfflineSearchWorkerResponse, "requestId" | "type">
  ): void {
    const response: OfflineSearchWorkerResponse = {
      ...body,
      requestId: request.requestId,
      type: request.type,
    };
    queueMicrotask(() => {
      const event = new MessageEvent<OfflineSearchWorkerResponse>("message", {
        data: response,
      });
      for (const listener of this.messageListeners) {
        listener(event);
      }
    });
  }
}

function clientWithWorker(
  worker: TestWorker,
  requestTimeoutMs = 100
): OfflineSearchWorkerClient {
  return createOfflineSearchWorkerClient({
    createWorker: () => worker as unknown as Worker,
    requestTimeoutMs,
  });
}

function sourceMessage(index: number) {
  return {
    message: {
      ciphertext: `cipher-${index}`,
      conversationId: "conversation-1",
      createdAt: index,
      id: `message-${index}`,
      iv: `iv-${index}`,
      keyEpoch: 0,
      ratchetIndex: index,
      revision: 1,
      senderId: "user-1",
    },
    payload: { content: `text-${index}`, type: "text" as const },
  };
}

describe("offline search worker client", () => {
  test("activates scope and splits index writes into bounded requests", async () => {
    const worker = new TestWorker();
    const client = clientWithWorker(worker);
    expect(await client.activateScope(scope)).toBe(true);
    const messages = Array.from({ length: 33 }, (_, index) =>
      sourceMessage(index)
    );
    const result = await client.index({
      activeConversationId: "conversation-1",
      messages,
      scope,
    });

    expect(result).toEqual({ indexed: 33, skipped: 0, success: true });
    expect(
      worker.posted
        .filter((request) => request.type === "index")
        .map((request) =>
          request.type === "index" ? request.messages.length : 0
        )
    ).toEqual([32, 1]);
    client.dispose();
  });

  test("worker errors settle all pending requests and allow disposal", async () => {
    const worker = new TestWorker();
    const client = clientWithWorker(worker);
    const activation = client.activateScope(scope);
    const pendingSearch = client.search({
      conversationId: "conversation-1",
      query: "needle",
      scope,
    });
    worker.fail();

    expect(await activation).toBe(false);
    expect(await pendingSearch).toBeNull();
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  test("caps outstanding work and resolves timed-out requests as unavailable", async () => {
    const worker = new TestWorker();
    worker.respondToMessages = false;
    const client = createOfflineSearchWorkerClient({
      createWorker: () => worker as unknown as Worker,
      requestTimeoutMs: 10,
    });
    const requests = Array.from({ length: 17 }, () =>
      client.search({
        conversationId: "conversation-1",
        query: "needle",
        scope,
      })
    );

    expect(worker.posted).toHaveLength(16);
    expect(await Promise.all(requests)).toEqual(
      Array.from({ length: 17 }, () => null)
    );
    client.dispose();
  });
});
