import { expect, test } from "bun:test";

import { isGuestQualityPost, isTrendingPost } from "./trending-eligibility";

test("native Trending requires a stored interaction instead of views or an old score", () => {
  const counts = { bookmarks: 0, comments: 0, responses: 0, vote: 0 };
  expect(isTrendingPost({ _count: counts })).toBe(false);
  for (const field of ["bookmarks", "comments", "responses", "vote"] as const) {
    expect(isTrendingPost({ _count: { ...counts, [field]: 1 } })).toBe(true);
  }
});

// Trending is the hot list and stays strict: a huge aura with no engagement is
// still not trending, which is what the feed-view cache test also asserts.
test("a huge aura alone never makes a post trending", () => {
  const counts = { bookmarks: 0, comments: 0, responses: 0, vote: 0 };
  expect(isTrendingPost({ _count: counts, aura: 1_000_000 })).toBe(false);
});

// Guests have no persona, so their gate is quality rather than the hot list.
// Aura is the persisted net-vote score, so it survives empty viewer counters.
test("guest quality admits net-positive aura and rejects quiet or negative posts", () => {
  const counts = { bookmarks: 0, comments: 0, responses: 0, vote: 0 };
  expect(isGuestQualityPost({ _count: counts, aura: 2 })).toBe(true);
  expect(isGuestQualityPost({ _count: counts, aura: -3 })).toBe(false);
  expect(isGuestQualityPost({ _count: counts, aura: 0 })).toBe(false);
  expect(isGuestQualityPost({ _count: counts })).toBe(false);
  // Any real engagement also qualifies, even at zero aura.
  expect(isGuestQualityPost({ _count: { ...counts, vote: 1 }, aura: 0 })).toBe(
    true
  );
});
