import { RequestTimeoutError } from "@/lib/http-get";

import {
  HistoryThrottledError,
  isHistoryNetworkError,
  isHistoryServerError,
} from "./history-throttle";

// Bound automatic retries and honor the server's cooldown. Missing membership
// and authentication errors need a user action rather than a retry storm.
export function messageReadRetryDelay(
  error: unknown,
  attempts: number
): number | null {
  if (attempts >= 3) {
    return null;
  }
  if (error instanceof HistoryThrottledError) {
    return error.retryAfterSeconds * 1000;
  }
  if (
    error instanceof RequestTimeoutError ||
    isHistoryNetworkError(error) ||
    isHistoryServerError(error)
  ) {
    return (attempts + 1) * 1000;
  }
  return null;
}
