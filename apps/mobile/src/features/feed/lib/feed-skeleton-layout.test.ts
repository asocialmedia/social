import { describe, expect, test } from "bun:test";

import {
  DYNAMIC_SKELETON_PROFILES,
  FEED_INITIAL_SKELETON_COUNT,
  FEED_LOAD_MORE_SKELETON_COUNT,
  isBlueskySkeletonIndex,
  skeletonLineWidth,
  skeletonProfileForIndex,
} from "./feed-skeleton-layout";

describe("feed-skeleton-layout", () => {
  test("rotates 8 varied profiles like web", () => {
    expect(DYNAMIC_SKELETON_PROFILES).toHaveLength(8);
    expect(skeletonProfileForIndex(0)).toEqual(DYNAMIC_SKELETON_PROFILES[0]);
    expect(skeletonProfileForIndex(8)).toEqual(DYNAMIC_SKELETON_PROFILES[0]);
  });

  test("initial and load-more counts match web", () => {
    expect(FEED_INITIAL_SKELETON_COUNT).toBe(8);
    expect(FEED_LOAD_MORE_SKELETON_COUNT).toBe(4);
  });

  test("bluesky rows alternate on the mixed feed", () => {
    expect(isBlueskySkeletonIndex("all", 0)).toBe(false);
    expect(isBlueskySkeletonIndex("all", 1)).toBe(true);
    expect(isBlueskySkeletonIndex("bluesky", 0)).toBe(true);
    expect(isBlueskySkeletonIndex("asm", 1)).toBe(false);
  });

  test("last line is 3/4, odd lines 11/12, rest full", () => {
    expect(skeletonLineWidth(1, 2)).toBe(0.75);
    expect(skeletonLineWidth(1, 4)).toBe(11 / 12);
    expect(skeletonLineWidth(0, 4)).toBe(1);
    expect(skeletonLineWidth(2, 4)).toBe(1);
  });
});
