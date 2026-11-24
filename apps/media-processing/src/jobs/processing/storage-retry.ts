import { isStorageBucketMissing } from "@asm/media";

const delaysMs = [30_000, 120_000, 300_000];

export function processStorageRetryAt(
  error: unknown,
  attemptsStarted: number,
  now = Date.now()
): number | undefined {
  const delay = delaysMs[attemptsStarted - 1];
  if (delay !== undefined && isStorageBucketMissing(error)) {
    return now + delay;
  }
}
