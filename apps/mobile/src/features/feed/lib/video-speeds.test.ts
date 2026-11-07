import { describe, expect, test } from "bun:test";

import {
  clampSeekTarget,
  DOUBLE_TAP_SEEK_SECONDS,
  doubleTapDirection,
  nextPlaybackSpeed,
  PLAYBACK_SPEEDS,
} from "./video-speeds";

describe("video speeds", () => {
  test("cycles through the 8 web steps and wraps", () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    const chain = [1.25, 1.5, 1.75, 2, 0.25, 0.5, 0.75, 1];
    let rate = 1;
    for (const expected of chain) {
      rate = nextPlaybackSpeed(rate);
      expect(rate).toBe(expected);
    }
    expect(nextPlaybackSpeed(3)).toBe(1);
  });

  test("double-tap zones split the stage in halves", () => {
    expect(doubleTapDirection(10, 400)).toBe("backward");
    expect(doubleTapDirection(399, 400)).toBe("forward");
    expect(doubleTapDirection(200, 400)).toBe("forward");
  });

  test("seek targets clamp into the duration", () => {
    expect(DOUBLE_TAP_SEEK_SECONDS).toBe(10);
    expect(clampSeekTarget(5, 10, 60)).toBe(15);
    expect(clampSeekTarget(55, 10, 60)).toBe(60);
    expect(clampSeekTarget(5, -10, 60)).toBe(0);
    expect(clampSeekTarget(5, 10, null)).toBe(15);
  });
});
