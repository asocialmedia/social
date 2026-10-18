import { expect, test } from "bun:test";

import { isTrendingPost } from "./trending-eligibility";

test("native Trending requires a stored interaction instead of views or an old score", () => {
  const counts = { bookmarks: 0, comments: 0, responses: 0, vote: 0 };
  expect(isTrendingPost({ _count: counts })).toBe(false);
  for (const field of ["bookmarks", "comments", "responses", "vote"] as const) {
    expect(isTrendingPost({ _count: { ...counts, [field]: 1 } })).toBe(true);
  }
});
