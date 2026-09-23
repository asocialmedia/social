// Retry policy for every upload/post request. Pure (the clock and randomness
// are injectable) so the decisions are unit-tested.
//
// Retryable: network failures, timeouts (408), rate limits (429) and 5xx.
// Everything else is a client error that retrying cannot fix.
import { AbortError } from "./abort-error";

export { AbortError } from "./abort-error";

export class HttpError extends Error {
  readonly retryAfterMs: number | null;
  readonly status: number;
  readonly body: unknown;
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AbortError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }
  if (error instanceof HttpError) {
    return isRetryableStatus(error.status);
  }
  // fetch/XHR network failures surface as TypeError (or native task errors).
  return true;
}

// `retry-after` is seconds or an HTTP date; capped so a hostile or broken
// header cannot park an upload forever.
export function parseRetryAfter(
  header: string | null | undefined,
  now = Date.now(),
  capMs = 60_000
): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(capMs, Math.max(0, seconds * 1000));
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.min(capMs, Math.max(0, date - now));
}

// Exponential backoff with full jitter, honoring a server retry-after hint.
export function backoffDelay(
  attempt: number,
  options: {
    baseMs?: number;
    maxMs?: number;
    random?: () => number;
    retryAfterMs?: number | null;
  } = {}
): number {
  const { baseMs = 1000, maxMs = 30_000, random = Math.random } = options;
  if (options.retryAfterMs !== null && options.retryAfterMs !== undefined) {
    return options.retryAfterMs;
  }
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- wrapping setTimeout + abort listener is the only way to build an abortable delay
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Runs `task` until it succeeds, a non-retryable error surfaces, or the
// attempts run out. `onRetry` is the logging hook.
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: {
    attempts: number;
    baseMs?: number;
    maxMs?: number;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
    signal?: AbortSignal;
  }
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new AbortError();
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- attempts are sequential by definition
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === options.attempts) {
        throw error;
      }
      const delay = backoffDelay(attempt, {
        baseMs: options.baseMs,
        maxMs: options.maxMs,
        retryAfterMs: error instanceof HttpError ? error.retryAfterMs : null,
      });
      options.onRetry?.(error, attempt, delay);
      // eslint-disable-next-line no-await-in-loop -- backoff must elapse before the next attempt
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}
