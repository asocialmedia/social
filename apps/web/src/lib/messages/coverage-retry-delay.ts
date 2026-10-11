export function coverageRetryDelay(attempt: number): number {
  const boundedAttempt = Number.isFinite(attempt)
    ? Math.min(Math.max(Math.trunc(attempt), 0), 4)
    : 0;
  return Math.min(1000 * 2 ** boundedAttempt, 15_000);
}
