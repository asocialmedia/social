import { createHash } from "node:crypto";

import { redis } from "../redis";
import { EMBEDDING_DIMENSION } from "./vector";

const hyperplanes = Array.from({ length: 80 }, (_, plane) => {
  let random = createHash("sha256")
    .update(`asm-semantic-v1:${plane}`)
    .digest()
    .readUInt32BE(0);
  return Array.from({ length: EMBEDDING_DIMENSION }, () => {
    random = (random * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return random >= 2_147_483_648 ? 1 : -1;
  });
});

// Fixed random hyperplanes create bounded approximate candidate buckets.
// Final scores use exact cosine similarity and database visibility checks.
export function semanticBuckets(
  model: string,
  vector: readonly number[]
): string[] {
  if (
    !model ||
    vector.length !== EMBEDDING_DIMENSION ||
    !vector.every(Number.isFinite) ||
    !vector.some(Boolean)
  ) {
    return [];
  }
  const namespace = createHash("sha256")
    .update(model)
    .digest("hex")
    .slice(0, 16);
  return Array.from({ length: 8 }, (_, table) => {
    let bits = 0;
    for (let bit = 0; bit < 10; bit += 1) {
      let projection = 0;
      for (let dim = 0; dim < vector.length; dim += 1) {
        projection +=
          (vector[dim] ?? 0) * (hyperplanes[table * 10 + bit]?.[dim] ?? 1);
      }
      if (projection >= 0) {
        bits += 2 ** bit;
      }
    }
    return `rec:semantic:v1:${namespace}:${table}:${bits}`;
  });
}

export async function indexPostEmbedding(
  postId: string,
  model: string,
  vector: readonly number[],
  timestamp: number
): Promise<void> {
  const buckets = semanticBuckets(model, vector);
  if (!buckets.length) {
    return;
  }
  const membership = `rec:semantic:membership:${postId}`;
  const previous = await redis.smembers(membership);
  const batch = redis.multi();
  for (const bucket of previous) {
    batch.zrem(bucket, postId);
  }
  batch.del(membership);
  batch.sadd(membership, ...buckets);
  for (const bucket of buckets) {
    batch.zadd(bucket, timestamp, postId);
    batch.zremrangebyrank(bucket, 0, -1001);
  }
  await batch.exec();
}

export async function retrieveSemanticCandidates(
  model: string | undefined,
  vector: readonly number[] | undefined
): Promise<string[]> {
  if (!model || !vector) {
    return [];
  }
  const buckets = semanticBuckets(model, vector);
  const results = await Promise.all(
    buckets.map((key) => redis.zrevrange(key, 0, 99))
  );
  const votes = new Map<string, number>();
  for (const result of results) {
    for (const id of result) {
      votes.set(id, (votes.get(id) ?? 0) + 1);
    }
  }
  return [...votes]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 200)
    .map(([id]) => id);
}
