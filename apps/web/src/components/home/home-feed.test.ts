import { describe, expect, test } from "bun:test";

import {
  feedIsRanked,
  HOME_FEED_QUERY_BEHAVIOR,
  probeOrdersNewestFirst,
} from "./home-feed";

describe("HomeFeed probe shape", () => {
  test("only the recency-ordered feed may answer the probe with one row", () => {
    // The one-row probe asks "did anything arrive?" by reading the top post's
    // id. That is only a sound question on a feed sorted newest-first: a post
    // published a moment ago is always the top row there.
    expect(probeOrdersNewestFirst("latest")).toBe(true);
    expect(probeOrdersNewestFirst("personalized")).toBe(false);
    expect(probeOrdersNewestFirst("global")).toBe(false);
    expect(probeOrdersNewestFirst("trending")).toBe(false);
  });

  test("the score-ordered feeds diff the whole head page instead", () => {
    // Ranked feeds can keep the same top row while a new post lands further
    // down, so they have to be read as a set rather than as a leading run.
    expect(feedIsRanked("personalized")).toBe(true);
    expect(feedIsRanked("global")).toBe(true);
    expect(feedIsRanked("trending")).toBe(true);
    expect(feedIsRanked("latest")).toBe(false);
  });
});

describe("HomeFeed query freshness", () => {
  test("refetches an invalidated tab when it mounts again", () => {
    expect(HOME_FEED_QUERY_BEHAVIOR.refetchOnMount).toBe(true);
  });

  test("never replaces a cached tab just because time passed", () => {
    // Infinity keeps tab-to-tab switches and long idle periods from triggering
    // a background replace; only invalidateQueries does. New posts surface via
    // the head probe instead.
    expect(HOME_FEED_QUERY_BEHAVIOR.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(HOME_FEED_QUERY_BEHAVIOR.refetchOnWindowFocus).toBe(false);
    expect(HOME_FEED_QUERY_BEHAVIOR.refetchOnReconnect).toBe(false);
  });

  test("retains cached pages across a post/media detour", () => {
    // 30 minutes comfortably outlives opening a post and its media viewer, so
    // coming back renders the cached pages instantly instead of refetching
    // from the top with a skeleton.
    expect(HOME_FEED_QUERY_BEHAVIOR.gcTime).toBe(30 * 60 * 1000);
  });
});
