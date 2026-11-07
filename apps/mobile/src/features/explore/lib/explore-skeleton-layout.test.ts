import { describe, expect, test } from "bun:test";

import {
  buildMasonryLayout,
  EXPLORE_CONTINUATION_SKELETON_COUNT,
  EXPLORE_GUSTS_SKELETON_COUNT,
  EXPLORE_PEOPLE_SKELETON_COUNT,
  SKELETON_POST_ASPECTS,
  splitIntoColumns,
} from "./explore-skeleton-layout";

describe("buildMasonryLayout", () => {
  test("produces one post per aspect", () => {
    const items = buildMasonryLayout();
    const posts = items.filter((item) => item.kind === "post");
    expect(posts).toHaveLength(SKELETON_POST_ASPECTS.length);
  });

  test("interleaves user cards at web's slots 4 and 9", () => {
    const items = buildMasonryLayout();
    const users = items.filter((item) => item.kind === "user");
    expect(users.length).toBe(2);
    expect(items[4]?.kind).toBe("user");
  });

  test("never leads with a user card", () => {
    expect(buildMasonryLayout()[0]?.kind).toBe("post");
  });

  test("matches web's item counts", () => {
    expect(EXPLORE_GUSTS_SKELETON_COUNT).toBe(8);
    expect(EXPLORE_PEOPLE_SKELETON_COUNT).toBe(8);
    expect(EXPLORE_CONTINUATION_SKELETON_COUNT).toBe(4);
  });
});

describe("splitIntoColumns", () => {
  test("alternates items across the two columns", () => {
    const items = buildMasonryLayout();
    const { left, right } = splitIntoColumns(items);
    expect(left.length + right.length).toBe(items.length);
    expect(left[0]).toBe(items[0]);
    expect(right[0]).toBe(items[1]);
    expect(left[1]).toBe(items[2]);
  });

  test("keeps columns within one item of each other", () => {
    const { left, right } = splitIntoColumns(buildMasonryLayout());
    expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(1);
  });
});
