import { expect, test } from "bun:test";

import { swipeTab } from "./tab-swipe";

test("swipes move through tabs and stop at each end", () => {
  const tabs = ["posts", "gusts", "hackernews", "likes"] as const;
  expect(swipeTab(tabs, "posts", 1)).toBe("gusts");
  expect(swipeTab(tabs, "hackernews", -1)).toBe("gusts");
  expect(swipeTab(tabs, "posts", -1)).toBe("posts");
  expect(swipeTab(tabs, "likes", 1)).toBe("likes");
});
