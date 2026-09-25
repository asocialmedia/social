// Shared between the messages client, which receives a 429, and the history
// backfill, which has to survive one.
//
// A separate module so the backfill does not have to import the whole messages
// client just for an error type, and so the client does not depend on the walker.

export class HistoryThrottledError extends Error {
  // Server's advice, in seconds. The walker waits this long rather than
  // inventing its own backoff, so a throttled walk slows down exactly as much as
  // the server asked and no more.
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("history request throttled");
    this.name = "HistoryThrottledError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export function isHistoryThrottled(
  error: unknown
): error is HistoryThrottledError {
  return error instanceof HistoryThrottledError;
}
