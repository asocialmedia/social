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

function generatorFeed(target: URL) {
  return target.pathname === "/xrpc/app.bsky.feed.getFeed"
    ? target.searchParams.get("feed")
    : null;
}

export function publicReadRateLimitScope(target: URL): string {
  const feed = generatorFeed(target);
  return feed ? `${target.origin}${target.pathname}:${feed}` : target.origin;
}

// Several distinct throttled generators warrant pausing their endpoint while post and profile reads continue.
export function createGeneratorBackoff(now: () => number) {
  const limited = new Map<string, number>();
  let blockedUntil = 0;
  return {
    record(target: URL, delay: number) {
      const feed = generatorFeed(target);
      if (!feed) {
        return;
      }
      const at = now();
      const until = at + Math.max(30_000, delay);
      if (blockedUntil > at) {
        blockedUntil = Math.max(blockedUntil, until);
        return;
      }
      for (const [id, expires] of limited) {
        if (expires <= at) {
          limited.delete(id);
        }
      }
      limited.set(feed, Math.max(until, limited.get(feed) ?? 0));
      if (limited.size >= 3) {
        blockedUntil = Math.max(...limited.values());
        limited.clear();
      }
    },
    remaining(target: URL) {
      return generatorFeed(target) ? Math.max(0, blockedUntil - now()) : 0;
    },
  };
}

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
        (operation === "app.bsky.feed.searchPosts" ||
          operation === "app.bsky.feed.searchPostsV2")) ||
      (url.hostname === "bsky.social" &&
        operation === "com.atproto.repo.listRecords")
    ) {
      return url;
    }
  } catch {
    // Invalid targets are rejected before performing network I/O.
  }
}
