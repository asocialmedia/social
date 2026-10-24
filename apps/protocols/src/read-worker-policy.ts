const publicOperations = new Set([
  "app.bsky.actor.getProfile",
  "app.bsky.actor.searchActors",
  "app.bsky.feed.getAuthorFeed",
  "app.bsky.feed.getFeed",
  "app.bsky.feed.getPostThread",
  "app.bsky.feed.getPosts",
  "app.bsky.feed.getSuggestedFeeds",
  "app.bsky.unspecced.getPopularFeedGenerators",
  "com.atproto.repo.getRecord",
]);

export function publicReadHeaders(input?: HeadersInit): Headers {
  const headers = new Headers({ accept: "application/json" });
  const language = new Headers(input).get("accept-language");
  if (language) {
    headers.set("accept-language", language);
  }
  return headers;
}

// Workers can read only these fixed public services; credentials, redirects and arbitrary destinations never cross this boundary.
export function publicReadTarget(raw: string): URL | undefined {
  if (raw.length > 16_384) {
    return;
  }
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return;
    }
    const operation = url.pathname.slice("/xrpc/".length);
    if (!url.pathname.startsWith("/xrpc/")) {
      return;
    }
    if (
      (url.hostname === "public.api.bsky.app" &&
        publicOperations.has(operation)) ||
      (url.hostname === "api.bsky.app" &&
        operation === "app.bsky.feed.searchPosts") ||
      (url.hostname === "bsky.social" &&
        operation === "com.atproto.repo.listRecords")
    ) {
      return url;
    }
  } catch {
    // Invalid targets are rejected before performing network I/O.
  }
}
