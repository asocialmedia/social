// Promise handlers bridge cancellation into transports that do not reject on abort.
// oxlint-disable promise/prefer-await-to-then, promise/avoid-new
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Request cancelled", "AbortError"));
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function waitForReadRetry(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

export function retryAfterMs(
  header: string | null,
  now = Date.now()
): number | undefined {
  if (!header?.trim()) {
    return;
  }
  const seconds = Number(header);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - now;
  return Number.isFinite(delay)
    ? Math.max(1000, Math.min(300_000, Math.ceil(delay)))
    : undefined;
}

export class FeedReadError extends Error {
  readonly status: number;
  readonly retryAfter: number;
  constructor(status: number, retryAfter = 1000) {
    super(
      status === 410
        ? "Refreshing the Bluesky feed"
        : "Bluesky is temporarily unavailable"
    );
    this.name = "FeedReadError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function canRetryRead(error: unknown): boolean {
  return error instanceof FeedReadError
    ? [408, 425, 429, 500, 502, 503, 504].includes(error.status)
    : error instanceof TypeError;
}

export async function readJsonBounded(
  response: Pick<Response, "headers" | "body" | "text">,
  maxBytes: number,
  signal: AbortSignal
): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Response exceeds the size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await abortable(response.text(), signal);
    if (new TextEncoder().encode(body).byteLength > maxBytes) {
      throw new Error("Response exceeds the size limit");
    }
    return JSON.parse(body) as unknown;
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- streamed chunks must be consumed in order.
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw new Error("Response exceeds the size limit");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    // Cancellation also releases a stalled body reader independently of fetch implementations.
    void reader.cancel().catch(() => null);
    reader.releaseLock();
  }
}
