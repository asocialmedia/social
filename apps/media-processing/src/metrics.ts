import { redis } from "@asm/db";

export async function recordMediaMetric(
  name: string,
  milliseconds: number
): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return;
  }
  try {
    const key = `media:metrics:v2:${name}`;
    const batch = redis.multi();
    batch.hincrby(`${key}:totals`, "count", 1);
    batch.hincrbyfloat(`${key}:totals`, "sumMs", milliseconds);
    batch.zadd(key, Date.now(), `${crypto.randomUUID()}:${milliseconds}`);
    batch.zremrangebyrank(key, 0, -4097);
    batch.expire(key, 86_400);
    batch.expire(`${key}:totals`, 86_400);
    await batch.exec();
  } catch {
    // Metrics are best effort and must never fail a media job.
  }
}

export function latencySummary(values: number[]): {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
} {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const quantile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    count: sorted.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    p99Ms: quantile(0.99),
  };
}

export async function mediaMetricSnapshot(): Promise<
  Record<string, ReturnType<typeof latencySummary>>
> {
  const names = [
    "job.media-scan",
    "job.media-process",
    "job.media-analyze",
    "upload.playable",
    "upload.labeled",
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const values = await redis.zrangebyscore(
          `media:metrics:v2:${name}`,
          Date.now() - 86_400_000,
          "+inf"
        );
        return [
          name,
          latencySummary(
            values.map((entry) => Number(entry.split(":").at(-1)))
          ),
        ];
      })
    )
  );
}
