import { describe, expect, it } from "bun:test";

import { REFRESH_SETTLE_MS, REFRESH_TIMING } from "./refresh-timing";

// Pull-to-refresh used to take ~2.2s from the refresh resolving to the list
// being back in place, and over half of that was a flat 1100ms hold doing
// nothing. These tests pin the budget and the shape of the sequence so the wait
// cannot quietly walk back up: the choreography is the slowest motion outside a
// page transition and it runs on every refresh of every pull-to-refresh screen.
describe("refresh timing", () => {
  it("settles well inside the old ~2.2s wait", () => {
    expect(REFRESH_SETTLE_MS).toBeLessThanOrEqual(1500);
  });

  it("adds up the sequence the loader actually plays", () => {
    // The pill opening and the label sliding in run in parallel, so that pair
    // costs the longer of the two, not the sum. Getting this wrong would
    // under-report the real wait by 60ms.
    const pillOpen = Math.max(
      REFRESH_TIMING.pillOpen,
      REFRESH_TIMING.labelInDelay + REFRESH_TIMING.labelIn
    );
    expect(REFRESH_SETTLE_MS).toBe(
      REFRESH_TIMING.badgeIn +
        pillOpen +
        REFRESH_TIMING.hold +
        REFRESH_TIMING.labelOut +
        REFRESH_TIMING.pillFold +
        REFRESH_TIMING.chipExit
    );
  });

  it("keeps the confirmation readable without stalling the list", () => {
    // Long enough to read "Feed updated", short enough not to feel stuck. This
    // is the dial that made the refresh feel slow when it was 1100ms.
    expect(REFRESH_TIMING.hold).toBeGreaterThanOrEqual(400);
    expect(REFRESH_TIMING.hold).toBeLessThanOrEqual(700);
  });

  it("gives the label time to arrive before the pill finishes opening", () => {
    expect(REFRESH_TIMING.labelInDelay).toBeLessThan(REFRESH_TIMING.pillOpen);
  });

  it("keeps every step a short, positive duration", () => {
    for (const [step, ms] of Object.entries(REFRESH_TIMING)) {
      expect(Number.isInteger(ms), `${step} must be a whole number of ms`).toBe(
        true
      );
      expect(ms, `${step} must be positive`).toBeGreaterThan(0);
    }
  });

  it("keeps the animated steps under half a second, hold aside", () => {
    // `hold` is a dwell rather than a motion and is bounded by its own test
    // above; everything else should read as a movement, not a wait.
    for (const [step, ms] of Object.entries(REFRESH_TIMING)) {
      if (step === "hold") {
        continue;
      }
      expect(ms, `${step} must stay under half a second`).toBeLessThanOrEqual(
        500
      );
    }
  });
});
