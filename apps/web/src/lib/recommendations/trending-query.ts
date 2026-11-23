export function trendingFeedQueryKey(userId?: string) {
  return ["trending-feed", "v6", userId ?? "guest"] as const;
}
