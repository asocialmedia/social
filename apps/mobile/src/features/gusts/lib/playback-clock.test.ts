import { describe, expect, test } from "bun:test";

import { createPlaybackClock } from "./playback-clock";

describe("playback clock", () => {
  test("notifies subscribers only when the position changes", () => {
    const clock = createPlaybackClock();
    let calls = 0;
    const unsubscribe = clock.subscribe(() => {
      calls += 1;
    });
    clock.set(1.25);
    clock.set(1.25);
    clock.set(1.5);
    expect(clock.get()).toBe(1.5);
    expect(calls).toBe(2);
    unsubscribe();
    clock.set(2);
    expect(calls).toBe(2);
  });

  test("clamps invalid and negative positions to zero", () => {
    const clock = createPlaybackClock(3);
    clock.set(Number.NaN);
    expect(clock.get()).toBe(0);
    clock.set(4);
    clock.set(-1);
    expect(clock.get()).toBe(0);
  });
});
