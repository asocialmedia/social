// Reuse card data across routes; stale entries refresh in the background on
// mount, focus, or reconnect. Explicit invalidation always overrides freshness.
export const CARD_QUERY_POLICY = {
  gcTime: 30 * 60 * 1000,
  staleTime: 5 * 60 * 1000,
} as const;
