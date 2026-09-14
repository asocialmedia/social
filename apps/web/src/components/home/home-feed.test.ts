import { describe, expect, test } from "bun:test";

import { HOME_FEED_QUERY_BEHAVIOR } from "./home-feed";

describe("HomeFeed query freshness", () => {
  test("refetches an invalidated tab when it mounts again", () => {
    expect(HOME_FEED_QUERY_BEHAVIOR.refetchOnMount).toBe(true);
  });
});
