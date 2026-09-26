import { beforeEach, describe, expect, test } from "bun:test";

import {
  applyCountDelta,
  clearCountDeltas,
  getCountDelta,
  subscribeCountDeltas,
  withCountDelta,
} from "./comment-count-deltas";

const key = { field: "comments", postId: "post-1" } as const;

beforeEach(() => {
  clearCountDeltas(key);
});

describe("comment count deltas", () => {
  test("a created event adds and a deleted one subtracts", () => {
    applyCountDelta(key, 1);
    expect(getCountDelta(key)).toBe(1);
    applyCountDelta(key, -1);
    expect(getCountDelta(key)).toBe(0);
  });

  test("a post with no deltas reads its own base count", () => {
    expect(getCountDelta(key)).toBe(0);
    expect(withCountDelta("post-1", "comments", 4)).toBe(4);
  });

  test("deltas accumulate across separate events", () => {
    applyCountDelta(key, 1);
    applyCountDelta(key, 1);
    expect(withCountDelta("post-1", "comments", 10)).toBe(12);
  });

  test("a delete racing the first fetch cannot render a negative count", () => {
    // The stream can report a delete for an eddie created before this client
    // ever loaded the post, so the base count is 0 while the delta is negative.
    applyCountDelta(key, -1);
    expect(withCountDelta("post-1", "comments", 0)).toBe(0);
  });

  test("comments and responses are tracked separately", () => {
    applyCountDelta({ field: "comments", postId: "post-1" }, 1);
    expect(getCountDelta({ field: "responses", postId: "post-1" })).toBe(0);
  });

  test("subscribers are notified and can unsubscribe", () => {
    let calls = 0;
    const off = subscribeCountDeltas(() => {
      calls += 1;
    });
    applyCountDelta(key, 1);
    off();
    applyCountDelta(key, 1);
    expect(calls).toBe(1);
  });
});
