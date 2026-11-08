// Web's SearchReadError copy (components/search/spotlight-search.ts): an
// HTTP failure says why, a rate limit says how long to wait, and anything
// else (offline, timeout, a malformed body) falls back to the generic line.
export const SEARCH_UNAVAILABLE_COPY = "Temporarily unavailable. Try again.";

export function searchErrorCopy(
  failure: { retryAfter?: number; status: number } | null
): string {
  if (!failure) {
    return SEARCH_UNAVAILABLE_COPY;
  }
  if (failure.status === 429) {
    return `Search limit reached. Try again in ${Math.max(1, failure.retryAfter ?? 1)}s.`;
  }
  return "Search is temporarily busy. Try again shortly.";
}
