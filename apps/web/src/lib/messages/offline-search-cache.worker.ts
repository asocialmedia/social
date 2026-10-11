import { createIndexedDbOfflineSearchCacheStore } from "./indexeddb-offline-search-cache";
import { createOfflineSearchWorkerProcessor } from "./offline-search-worker-core";
import type {
  OfflineSearchWorkerRequest,
  OfflineSearchWorkerResponse,
} from "./offline-search-worker-core";

interface OfflineSearchWorkerGlobal {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<OfflineSearchWorkerRequest>) => void
  ) => void;
  postMessage: (message: OfflineSearchWorkerResponse) => void;
}

const workerGlobal = self as unknown as OfflineSearchWorkerGlobal;
const sendWorkerResponse = workerGlobal.postMessage.bind(workerGlobal);
const processor = createOfflineSearchWorkerProcessor({
  cache: createIndexedDbOfflineSearchCacheStore(),
});

workerGlobal.addEventListener("message", (event) => {
  const handleMessage = async () => {
    try {
      const response = await processor.handle(event.data);
      sendWorkerResponse(response);
    } catch {
      sendWorkerResponse({
        error: "unavailable",
        requestId: event.data.requestId,
        success: false,
        type: event.data.type,
      });
    }
  };
  void handleMessage();
});
