import { describe, expect, test } from "bun:test";

import { updateVideoClockDuration, updateVideoClockTime } from "./video-clock";

describe("native video clock lifecycle", () => {
  const player = Object.freeze({});
  const clock = { duration: 10, player, seconds: 2 };

  test("quarter-second ticks retain identity until the displayed second changes", () => {
    expect(updateVideoClockTime(clock, player, 2.25)).toBe(clock);
    expect(updateVideoClockTime(clock, player, 2.75)).toBe(clock);
    expect(updateVideoClockTime(clock, player, 3.01)).toEqual({
      ...clock,
      seconds: 3,
    });
  });
  test("a late event from a previous player cannot update the new clock", () => {
    const previousPlayer = Object.freeze({});
    expect(updateVideoClockTime(clock, previousPlayer, 8)).toBe(clock);
    expect(updateVideoClockDuration(clock, previousPlayer, 80)).toBe(clock);
  });
  test("time events never dereference a released native player", () => {
    const releasedPlayer = Object.defineProperty({}, "duration", {
      get: () => {
        throw new Error("already released");
      },
    });
    const releasedClock = { duration: 10, player: releasedPlayer, seconds: 0 };
    expect(
      updateVideoClockTime(releasedClock, releasedPlayer, 1.5).seconds
    ).toBe(1);
    expect(
      updateVideoClockDuration(releasedClock, releasedPlayer, 12).duration
    ).toBe(12);
  });
  test("invalid time values preserve the previous display", () => {
    expect(updateVideoClockTime(clock, player, Number.NaN)).toBe(clock);
    expect(updateVideoClockTime(clock, player, Number.POSITIVE_INFINITY)).toBe(
      clock
    );
    expect(updateVideoClockTime(clock, player, -1).seconds).toBe(0);
  });
  test("invalid or unchanged load durations preserve identity", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 10]) {
      expect(updateVideoClockDuration(clock, player, duration)).toBe(clock);
    }
  });
  test("source load updates duration without moving the playhead", () => {
    expect(updateVideoClockDuration(clock, player, 15)).toEqual({
      ...clock,
      duration: 15,
    });
  });
});
