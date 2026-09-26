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

// The API's error shape, without importing the client: the backfill must stay
// free of it (see above), so failures are classified by shape, not by class.
function apiStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { status } = error as { status?: unknown };
  return typeof status === "number" ? status : null;
}

// A 401 from a history fetch. Retried like a throttle, not failed like a 404:
// sessions flap (two tabs racing a rotation, a proxy blip), and a single
// unauthorized page must not kill a 400-page walk that is otherwise healthy.
// A genuinely dead session still fails the run once the attempts below run out.
export function isHistoryUnauthorized(error: unknown): boolean {
  return apiStatus(error) === 401;
}

// A 5xx from a history fetch. Server blips heal; fail-fast would turn every
// deploy or hiccup into a dead walk.
export function isHistoryServerError(error: unknown): boolean {
  const status = apiStatus(error);
  return status !== null && status >= 500 && status <= 599;
}

// A fetch that never got an answer: the network dropped, or the dev server
// restarted mid-page (HMR recompiles abort in-flight requests). Retried for the
// same reason as the two above. AbortError is deliberately NOT this: an
// aborted request is a stop, and stops are silent by contract, never failures.
export function isHistoryNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}
