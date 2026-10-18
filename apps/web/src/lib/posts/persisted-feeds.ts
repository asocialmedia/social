interface FeedQuery {
  queryKey: readonly unknown[];
  state: { status: string; dataUpdatedAt: number };
}

// Keep private caches separate for every signed-in account and exclude non-feed data.
export function shouldPersistFeed(query: FeedQuery, viewer: string) {
  const [kind, name, owner] = query.queryKey;
  if (
    query.state.status !== "success" ||
    Date.now() - query.state.dataUpdatedAt > 10 * 60 * 1000
  ) {
    return false;
  }
  if (kind === "bluesky-discovery") {
    return owner === viewer;
  }
  return (
    kind === "post-feed" &&
    owner === viewer &&
    ["latest", "for-you", "trending", "bookmarks", "following"].includes(
      String(name)
    )
  );
}
