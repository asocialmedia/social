import { canonicalExposureFeed } from "@/lib/posts/feed-exposure";

const measured = new Set<string>();

// Record first actual card visibility, after the feed response and React commit, without another analytics request.
export function recordFeedRenderTiming(surface: string, feed: string) {
  if (typeof performance === "undefined") {
    return;
  }
  const resources = performance.getEntriesByType(
    "resource"
  ) as PerformanceResourceTiming[];
  const mode = canonicalExposureFeed(feed);
  const response = resources.findLast((entry) => {
    const url = new URL(entry.name);
    if (url.pathname === "/api/protocols/bluesky/discover") {
      return (
        url.searchParams.get("mode") === mode &&
        (url.searchParams.get("surface") === "explore") ===
          (surface === "explore") &&
        (url.searchParams.get("content") === "video") === (surface === "gusts")
      );
    }
    if (surface === "gusts") {
      return url.pathname === "/api/gusts";
    }
    return (
      url.pathname ===
        `/api/posts/${mode === "personalized" ? "for-you" : mode}` &&
      (url.searchParams.get("surface") === "explore") ===
        (surface === "explore")
    );
  });
  if (!response || response.responseEnd <= 0) {
    return;
  }
  const key = `${surface}:${feed}:${response.startTime}`;
  if (measured.has(key)) {
    return;
  }
  measured.add(key);
  if (measured.size > 100) {
    measured.delete(measured.values().next().value ?? "");
  }
  const end = performance.now();
  const detail = { feed, surface };
  performance.measure("asm.feed.network-to-visible", {
    detail,
    end,
    start: response.startTime,
  });
  performance.measure("asm.feed.response-to-visible", {
    detail,
    end,
    start: response.responseEnd,
  });
}
