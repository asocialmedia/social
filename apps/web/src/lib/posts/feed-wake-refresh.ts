import type { QueryClient } from "@tanstack/react-query";

export const FEED_WAKE_AGE_MS = 10 * 60_000;
const FEED_KINDS = new Set([
  "post-feed",
  "bluesky-discovery",
  "bluesky-following",
  "explore-feed",
  "explore-top-gusts",
  "gusts-feed",
  "explore-gusts-grid",
]);

// Expired continuation cursors must never be replayed after the laptop wakes.
export async function refreshExpiredFeeds(
  client: QueryClient,
  now = Date.now()
) {
  const stale = client
    .getQueryCache()
    .findAll()
    .filter(
      (query) =>
        FEED_KINDS.has(String(query.queryKey[0])) &&
        query.state.status === "success" &&
        now - query.state.dataUpdatedAt >= FEED_WAKE_AGE_MS
    );
  for (const query of stale) {
    const { data } = query.state;
    if (
      data &&
      typeof data === "object" &&
      "pages" in data &&
      "pageParams" in data &&
      Array.isArray(data.pages) &&
      Array.isArray(data.pageParams)
    ) {
      client.setQueryData(
        query.queryKey,
        {
          ...data,
          pageParams: data.pageParams.slice(0, 1),
          pages: data.pages.slice(0, 1),
        },
        { updatedAt: query.state.dataUpdatedAt }
      );
    }
  }
  await Promise.all(
    stale.map((query) =>
      client.invalidateQueries({ exact: true, queryKey: query.queryKey })
    )
  );
}
