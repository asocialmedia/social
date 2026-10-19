import { createHash } from "node:crypto";

import { redis } from "@asm/db";

// What a viewer was actually served, so a refresh cannot replay the same head.
// Client-side exposure tracking only covers one browser and is applied after
// pagination; this is the server-side memory that keeps a feed moving forward.
const KEY_PREFIX = "rec:served:v1";
const MAX_SERVED = 2000;
// Long enough to cover a long scroll session, short enough that old posts can
// return once they are no longer the freshest thing in the pool.
const SERVED_TTL_SECONDS = 7 * 24 * 60 * 60;

function keyFor(viewer: string, surface: string) {
  return `${KEY_PREFIX}:{${createHash("sha256")
    .update(`${viewer}:${surface}`)
    .digest("hex")}}`;
}

// Read the recently served ids for one surface. Fails open: a cache outage must
// never block a feed read, it only means the ordering may repeat.
export async function readServedIds(
  viewer: string,
  surface: string,
  limit = MAX_SERVED
): Promise<string[]> {
  if (!viewer) {
    return [];
  }
  try {
    return await redis.zrange(keyFor(viewer, surface), String(-limit), "-1");
  } catch {
    return [];
  }
}

// Record what this page served. Scores are epoch milliseconds so a range trim
// can drop anything older than the retention window.
export async function recordServedIds(
  viewer: string,
  surface: string,
  ids: readonly string[]
) {
  if (!viewer || ids.length === 0) {
    return;
  }
  const key = keyFor(viewer, surface);
  const now = Date.now();
  try {
    const pipeline = redis.multi();
    for (const id of ids) {
      pipeline.zadd(key, String(now), id);
    }
    pipeline.zremrangebyrank(key, 0, -(MAX_SERVED + 1));
    pipeline.expire(key, SERVED_TTL_SECONDS);
    await pipeline.exec();
  } catch {
    // Serving already happened; losing the bookmark only costs dedupe later.
  }
}
