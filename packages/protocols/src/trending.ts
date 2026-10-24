import type { ExternalPost } from "./contracts";

export const MIN_BLUESKY_TRENDING_ENGAGEMENT = 10;

export function externalTrendingEngagement(
  post: Pick<ExternalPost, "upstreamCounts">
): number {
  const counts = post.upstreamCounts;
  return [counts.likes, counts.replies, counts.reposts, counts.quotes].reduce(
    (total, count) =>
      total + (Number.isFinite(count) ? Math.max(0, count ?? 0) : 0),
    0
  );
}

export function isExternalTrendingPost(
  post: Pick<ExternalPost, "upstreamCounts">
): boolean {
  return externalTrendingEngagement(post) >= MIN_BLUESKY_TRENDING_ENGAGEMENT;
}
