import { describe, expect, test } from "bun:test";

import { HOME_FEED_QUERY_BEHAVIOR } from "./home-feed";

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
});
