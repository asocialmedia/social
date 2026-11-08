// Deadline math for incognito message expiry.
// The incognito thread used to re-render every second to evict expired rows,
// which also rebuilt every bubble's props and defeated their memos. A single
// timeout aimed at the next expiry does the same eviction with no idle work.
export function nextExpiryDelayMs(
  expiryTimesMs: readonly number[],
  nowMs: number
): number | null {
  let soonest: number | null = null;
  for (const at of expiryTimesMs) {
    const delay = at - nowMs;
    if (delay <= 0) {
      return 0;
    }
    if (soonest === null || delay < soonest) {
      soonest = delay;
    }
  }
  return soonest;
}
