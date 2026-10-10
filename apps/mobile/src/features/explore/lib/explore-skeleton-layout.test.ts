import { describe, expect, test } from "bun:test";

import {
  buildMasonryLayout,
  SKELETON_POST_ASPECTS,
  splitIntoColumns,
} from "./explore-skeleton-layout";

describe("buildMasonryLayout", () => {
  test("produces one post per aspect", () => {
    const items = buildMasonryLayout();
    const posts = items.filter((item) => item.kind === "post");
    expect(posts).toHaveLength(SKELETON_POST_ASPECTS.length);
  });

  test("interleaves a user card at every sixth slot, not the first", () => {
    const items = buildMasonryLayout();
    const [, second] = items;
    expect(second?.kind).toBe("post");
    // Index 6 in the ORIGINAL aspects array triggers a user insert, so by the
    // time it is pushed the post stream has one extra item ahead of it.
    const users = items.filter((item) => item.kind === "user");
    expect(users.length).toBe(1);
  });

  test("never leads with a user card", () => {
    expect(buildMasonryLayout()[0]?.kind).toBe("post");
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
