import { redis } from "@asm/db";
import { externalFeedbackKey } from "@asm/protocols/discovery";
import type { ExternalFeedback } from "@asm/protocols/discovery";

const RETENTION_SECONDS = 90 * 24 * 60 * 60;
const MAX_SIGNALS = 500;
const keyFor = (userId: string) => `protocols:feedback:bluesky:${userId}`;

export async function readExternalFeedback(
  userId: string
): Promise<Set<string>> {
  const now = Date.now();
  const key = keyFor(userId);
  return new Set(
    await redis.zrangebyscore(
      key,
      String(now - RETENTION_SECONDS * 1000),
      "+inf",
      "LIMIT",
      0,
      MAX_SIGNALS
    )
  );
}

export async function writeExternalFeedback(
  userId: string,
  feedback: ExternalFeedback,
  remove: boolean
) {
  const key = keyFor(userId);
  const member = externalFeedbackKey(feedback);
  if (remove) {
    await redis.zrem(key, member);
    return;
  }
  const result = await redis
    .multi()
    .zremrangebyscore(
      key,
      "-inf",
      String(Date.now() - RETENTION_SECONDS * 1000)
    )
    .zadd(key, Date.now(), member)
    .zremrangebyrank(key, 0, -MAX_SIGNALS - 1)
    .expire(key, RETENTION_SECONDS)
    .exec();
  if (!result || result.some(([error]) => error)) {
    throw new Error("Unable to save recommendation preference");
  }
}
