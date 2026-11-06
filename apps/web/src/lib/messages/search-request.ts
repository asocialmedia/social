import { fetchChatApi } from "./chat-capability";

const SEARCH_REQUEST_TIMEOUT_MS = 12_000;

export class MessageSearchRequestError extends Error {
  readonly retryAt: number;
  readonly restartRequired: boolean;

  constructor(message: string, retryAt = 0, restartRequired = false) {
    super(message);
    this.name = "MessageSearchRequestError";
    this.retryAt = retryAt;
    this.restartRequired = restartRequired;
  }
}

function retryAtFromResponse(response: Response): number {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) {
    return 0;
  }
  const seconds = Number(retryAfter);
  const deadline = Number.isFinite(seconds)
    ? Date.now() + seconds * 1000
    : Date.parse(retryAfter);
  return Number.isFinite(deadline)
    ? Math.min(Date.now() + 60_000, Math.max(Date.now(), deadline))
    : 0;
}

async function cancelSearchReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // A response that already closed needs no further cancellation.
  }
}

async function readSearchJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) {
    await response.body?.cancel();
    throw signal.reason;
  }
  if (Number(response.headers.get("Content-Length")) > maxBytes) {
    await response.body?.cancel();
    throw new MessageSearchRequestError(
      "Search returned too much data. Refine your query."
    );
  }
  if (!response.body) {
    throw new MessageSearchRequestError(
      "Search results could not be loaded. Try again."
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  const cancel = () => {
    void cancelSearchReader(reader, signal.reason);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- read one bounded response chunk at a time.
      const chunk = await reader.read();
      if (signal.aborted) {
        throw signal.reason;
      }
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop -- cancel the bounded sequential stream before returning.
        await reader.cancel();
        throw new MessageSearchRequestError(
          "Search returned too much data. Refine your query."
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function fetchMessageSearchJson(
  url: string,
  init: RequestInit,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<unknown> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new MessageSearchRequestError("Connect to the internet to search.");
  }
  const controller = new AbortController();
  const parentSignal = init.signal;
  const cancel = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) {
    cancel();
  } else {
    parentSignal?.addEventListener("abort", cancel, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? SEARCH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchChatApi(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryAt = retryAtFromResponse(response);
      await response.body?.cancel();
      if (response.status === 429) {
        throw new MessageSearchRequestError(
          "Please wait a moment before searching again.",
          retryAt || Date.now() + 15_000
        );
      }
      if (response.status === 409) {
        throw new MessageSearchRequestError(
          "These results changed. Search again to refresh them.",
          0,
          true
        );
      }
      throw new MessageSearchRequestError(
        response.status === 401
          ? "Sign in again to search."
          : "Search is temporarily unavailable. Please try again.",
        retryAt
      );
    }
    return await readSearchJson(
      response,
      options.maxBytes ?? 1024 * 1024,
      controller.signal
    );
  } catch (error) {
    if (parentSignal?.aborted) {
      throw error;
    }
    if (timedOut) {
      throw new MessageSearchRequestError(
        "Search took too long. Check your connection and try again."
      );
    }
    if (error instanceof MessageSearchRequestError) {
      throw error;
    }
    throw new MessageSearchRequestError(
      "Search could not connect. Please try again."
    );
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", cancel);
  }
}
