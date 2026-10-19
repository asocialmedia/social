import { expect, test } from "bun:test";

import { isTrendingPost } from "./trending-eligibility";

test("native Trending requires stored engagement instead of views or an old score", () => {
  const counts = { bookmarks: 0, comments: 0, responses: 0, vote: 0 };
  expect(isTrendingPost({ _count: counts, aura: 0 })).toBe(false);
  for (const field of ["bookmarks", "comments", "responses", "vote"] as const) {
    expect(isTrendingPost({ _count: { ...counts, [field]: 1 }, aura: 0 })).toBe(
      true
    );
  }
});

// Aura is the persisted net-vote score, so it survives the viewer-scoped counters
// being empty. Without this every guest feed and every cold-start feed is blank.
test("stored aura makes a post eligible when viewer-scoped counters are empty", () => {
  const counts = { bookmarks: 0, comments: 0, responses: 0, vote: 0 };
  expect(isTrendingPost({ _count: counts, aura: 2 })).toBe(true);
  expect(isTrendingPost({ _count: counts, aura: -3 })).toBe(false);
  expect(isTrendingPost({ _count: counts })).toBe(false);
});
