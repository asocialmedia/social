import { describe, expect, test } from "bun:test";

import { pullDistance, pullGestureDecision } from "./android-pull";

const drag = { offset: 0, refreshing: false, touches: 1, x: 0, y: 100 };

describe("Android pull eligibility", () => {
  test("a downward drag in the middle of a restored feed belongs to scrolling", () => {
    for (const offset of [1, 400, 2500]) {
      expect(pullGestureDecision({ ...drag, offset })).toBe("fail");
    }
  });
  test("only a deliberate downward drag at the top activates refresh", () => {
    expect(pullGestureDecision(drag)).toBe("activate");
    expect(pullGestureDecision({ ...drag, y: 7 })).toBe("wait");
    expect(pullGestureDecision({ ...drag, y: -20 })).toBe("fail");
    expect(pullGestureDecision({ ...drag, x: 30 })).toBe("fail");
    expect(pullGestureDecision({ ...drag, touches: 2 })).toBe("fail");
    expect(pullGestureDecision({ ...drag, refreshing: true })).toBe("fail");
  });
  test("pull distance follows the finger with resistance and returns to zero", () => {
    expect(pullDistance(120, 20)).toBeCloseTo(55);
    expect(pullDistance(10, 20)).toBe(0);
  });
});
