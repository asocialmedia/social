import { describe, expect, test } from "bun:test";

import {
  FLICK_VELOCITY,
  HANDOFF_DISTANCE,
  SWIPE_DISTANCE,
  clampIndex,
  handoffIndex,
  retainPagerPages,
  settleIndex,
} from "./pager-navigation";

describe("clampIndex", () => {
  test("keeps an index inside the page range", () => {
    expect(clampIndex(2, 4)).toBe(2);
    expect(clampIndex(-1, 4)).toBe(0);
    expect(clampIndex(9, 4)).toBe(3);
  });

  test("collapses to zero when there are no pages", () => {
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe("handoffIndex", () => {
  test("holds the origin until the drag clearly points at a neighbour", () => {
    expect(handoffIndex(1, 0, 4)).toBe(1);
    expect(handoffIndex(1, HANDOFF_DISTANCE - 1, 4)).toBe(1);
    expect(handoffIndex(1, -(HANDOFF_DISTANCE - 1), 4)).toBe(1);
  });

  test("hands over before the swipe could possibly commit", () => {
    expect(HANDOFF_DISTANCE).toBeLessThan(SWIPE_DISTANCE);
    expect(handoffIndex(1, HANDOFF_DISTANCE, 4)).toBe(0);
    expect(handoffIndex(1, -HANDOFF_DISTANCE, 4)).toBe(2);
  });

  test("follows the finger back to the origin", () => {
    expect(handoffIndex(1, 40, 4)).toBe(0);
    expect(handoffIndex(1, 5, 4)).toBe(1);
    expect(handoffIndex(1, -5, 4)).toBe(1);
  });

  test("clamps at the first and last page", () => {
    // Dragging right from the first page (and left from the last) has nowhere
    // to go, so the hand-off stays on the edge instead of running off.
    expect(handoffIndex(0, 200, 4)).toBe(0);
    expect(handoffIndex(3, -200, 4)).toBe(3);
    // The other direction still moves.
    expect(handoffIndex(0, -200, 4)).toBe(1);
    expect(handoffIndex(3, 200, 4)).toBe(2);
  });
});

describe("settleIndex", () => {
  test("commits a full swipe of travel", () => {
    expect(settleIndex(1, -SWIPE_DISTANCE, 0, 4)).toBe(2);
    expect(settleIndex(1, SWIPE_DISTANCE, 0, 4)).toBe(0);
  });

  test("commits a short flick on speed alone", () => {
    expect(FLICK_VELOCITY).toBeGreaterThan(0);
    expect(settleIndex(1, -10, -FLICK_VELOCITY, 4)).toBe(2);
    expect(settleIndex(1, 10, FLICK_VELOCITY, 4)).toBe(0);
  });

  test("springs back on a slow drag short of both", () => {
    expect(settleIndex(1, -20, -0.1, 4)).toBe(1);
    expect(settleIndex(1, 20, 0.1, 4)).toBe(1);
  });

  test("measures from the page the drag started on, not the hand-off", () => {
    // Handed over to page 2 mid-drag, then dragged most of the way back and
    // released: the track springs home to the origin it came from.
    expect(settleIndex(1, -5, 0, 4)).toBe(1);
  });

  test("never runs past the edges", () => {
    expect(settleIndex(0, SWIPE_DISTANCE, 0, 4)).toBe(0);
    expect(settleIndex(3, -SWIPE_DISTANCE, 0, 4)).toBe(3);
  });
});

describe("retained feed pages", () => {
  test("initial mount preloads only adjacent pages", () => {
    expect(retainPagerPages(0, 4)).toEqual({ first: 0, last: 1 });
    expect(retainPagerPages(1, 4)).toEqual({ first: 0, last: 2 });
    expect(retainPagerPages(3, 4)).toEqual({ first: 2, last: 3 });
  });

  test("a tab detour keeps measured lists mounted on the return journey", () => {
    const initial = retainPagerPages(1, 4);
    const following = retainPagerPages(3, 4, initial);
    expect(following).toEqual({ first: 0, last: 3 });
    expect(retainPagerPages(1, 4, following)).toBe(following);
  });

  test("retention never extends past the page count", () => {
    expect(retainPagerPages(999, 4)).toEqual({ first: 2, last: 3 });
    expect(retainPagerPages(0, 1)).toEqual({ first: 0, last: 0 });
    expect(retainPagerPages(0, 0)).toEqual({ first: 0, last: -1 });
  });
});
