import { describe, expect, test } from "bun:test";

import { exploreFeedTabs, explorePageIndex } from "./explore-navigation";

describe("Explore grouped discovery navigation", () => {
  test("For you and Trending share one visible tab slot", () => {
    expect(exploreFeedTabs("for-you").map((tab) => tab.value)).toEqual([
      "for-you",
      "gusts",
      "people",
    ]);
    expect(exploreFeedTabs("trending").map((tab) => tab.value)).toEqual([
      "trending",
      "gusts",
      "people",
    ]);
  });
  test("both discovery choices map to the same swipe page", () => {
    expect(explorePageIndex("for-you")).toBe(0);
    expect(explorePageIndex("trending")).toBe(0);
    expect(explorePageIndex("gusts")).toBe(1);
    expect(explorePageIndex("people")).toBe(2);
  });
});
