import { createHash, randomUUID } from "node:crypto";

import type { PostData } from "../client";
import { redis } from "../redis";

export interface RankingContext {
  contentKind?: string;
  requestId: string;
  position: number;
  rankerVersion: string;
  experiment: string;
  variant: string;
  sources: string[];
}

// Stable assignment uses account identity, never per-request randomness.
export function rankingAssignment(
  userId: string,
  percentage = Number(process.env.RECOMMENDATION_EXPERIMENT_PERCENT ?? 0)
) {
  const enabled = Number.isFinite(percentage)
    ? Math.min(100, Math.max(0, percentage))
    : 0;
  const bucket =
    createHash("sha256")
      .update(`balanced-v1:${userId}`)
      .digest()
      .readUInt32BE(0) % 100;
  const variant = bucket < enabled ? "balanced" : "control";
  return { experiment: "balanced-v1", rankerVersion: "heuristic-v3", variant };
}

export async function attributeFeedPage(
  userId: string,
  posts: PostData[],
  sources: ReadonlyMap<string, string[]>,
  offset = 0
): Promise<PostData[]> {
  if (!posts.length) {
    return posts;
  }
  const requestId = randomUUID();
  const assignment = rankingAssignment(userId);
  const contexts = posts.map((post, index) => [
    post.id,
    JSON.stringify({
      ...assignment,
      contentKind: post.attachments.some(
        (attachment) => attachment.type === "VIDEO"
      )
        ? "video"
        : "post",
      position: offset + index,
      requestId,
      sources: sources.get(post.id) ?? ["snapshot"],
    }),
  ]);
  try {
    const result = await redis
      .multi()
      .hset(`rec:exposure:v1:${userId}:${requestId}`, ...contexts.flat())
      .expire(`rec:exposure:v1:${userId}:${requestId}`, 86_400)
      .exec();
    if (!result || result.some(([error]) => error)) {
      return posts;
    }
    return posts.map((post) => ({ ...post, recommendation: { requestId } }));
  } catch {
    // Feed delivery survives telemetry storage outages; do not fabricate attribution.
    return posts;
  }
}

export async function resolveRankingContext(
  userId: string,
  postId: string,
  requestId?: string
): Promise<RankingContext | null> {
  if (!requestId || !/^[a-f\d-]{36}$/i.test(requestId)) {
    return null;
  }
  const stored = await redis
    .hget(`rec:exposure:v1:${userId}:${requestId}`, postId)
    .catch(() => null);
  if (!stored) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("requestId" in value) ||
    value.requestId !== requestId ||
    !("position" in value) ||
    !Number.isInteger(value.position) ||
    !("rankerVersion" in value) ||
    typeof value.rankerVersion !== "string" ||
    !("experiment" in value) ||
    typeof value.experiment !== "string" ||
    !("variant" in value) ||
    typeof value.variant !== "string" ||
    !("sources" in value) ||
    !Array.isArray(value.sources) ||
    !value.sources.every((source) => typeof source === "string")
  ) {
    return null;
  }
  return {
    ...("contentKind" in value && typeof value.contentKind === "string"
      ? { contentKind: value.contentKind }
      : {}),
    experiment: value.experiment,
    position: Number(value.position),
    rankerVersion: value.rankerVersion,
    requestId,
    sources: value.sources,
    variant: value.variant,
  };
}

export async function rememberRankingImpression(
  userId: string,
  postId: string,
  context: RankingContext
): Promise<void> {
  await redis
    .set(
      `rec:last-impression:v1:${userId}:${postId}`,
      context.requestId,
      "EX",
      3600
    )
    .catch(() => null);
}

export async function resolveLastRankingContext(
  userId: string,
  postId: string
): Promise<RankingContext | null> {
  const requestId = await redis
    .get(`rec:last-impression:v1:${userId}:${postId}`)
    .catch(() => null);
  return resolveRankingContext(userId, postId, requestId ?? undefined);
}
