import { isStorageBucketMissing } from "@asm/media";

const delaysMs = [30_000, 120_000, 300_000];

export function processStorageDeferral(
  error: unknown,
  bucketDeferrals = 0,
  now = Date.now()
) {
  const delay = delaysMs[bucketDeferrals];
  if (delay !== undefined && isStorageBucketMissing(error)) {
    return { bucketDeferrals: bucketDeferrals + 1, retryAt: now + delay };
  }
}
