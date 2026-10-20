import { expect, test } from "bun:test";

import { isExternalTrendingPost } from "./trending";

test("Bluesky Trending requires ten real engagements and handles unknown metrics conservatively", () => {
  const quiet = { likes: 0, quotes: 0, replies: 0, reposts: 0 };
  expect(isExternalTrendingPost({ upstreamCounts: quiet })).toBe(false);
  expect(
    isExternalTrendingPost({ upstreamCounts: { ...quiet, likes: 9 } })
  ).toBe(false);
  expect(
    isExternalTrendingPost({ upstreamCounts: { ...quiet, likes: 10 } })
  ).toBe(true);
  expect(
    isExternalTrendingPost({
      upstreamCounts: { likes: 0, quotes: 2, replies: 3, reposts: 5 },
    })
  ).toBe(true);
  expect(
    isExternalTrendingPost({
      upstreamCounts: { ...quiet, likes: Number.NaN, replies: Infinity },
    })
  ).toBe(false);
});
