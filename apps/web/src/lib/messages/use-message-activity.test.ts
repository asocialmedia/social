import { describe, expect, test } from "bun:test";

import { activityRetryDelay } from "./use-message-activity";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

describe("activityRetryDelay", () => {
  test("resets to the floor once a subscription is confirmed", () => {
    // A confirmed stream means Redis accepted the subscribe, so whatever drops
    // next is a new problem rather than the same one failing again.
    expect(activityRetryDelay(16_000, true)).toBe(INITIAL_RETRY_MS);
    expect(activityRetryDelay(INITIAL_RETRY_MS, true)).toBe(INITIAL_RETRY_MS);
  });

  test("keeps climbing while no subscription is confirmed", () => {
    // The server answers 200 before it subscribes, so an outage produces a
    // response with a body that closes and never sends `connected`. Resetting on
    // that response is what turns a Redis outage into a once-a-second reconnect
    // loop, so the ladder has to keep widening instead.
    expect(activityRetryDelay(INITIAL_RETRY_MS, false)).toBe(2000);
    expect(activityRetryDelay(2000, false)).toBe(4000);
    expect(activityRetryDelay(16_000, false)).toBe(30_000);
  });

  test("caps at the maximum rather than growing without bound", () => {
    expect(activityRetryDelay(MAX_RETRY_MS, false)).toBe(MAX_RETRY_MS);
  });

  test("an unconfirmed stream reaching the cap is not reset by the cap alone", () => {
    // Guards the specific failure: if the ladder were ever seeded from a
    // response rather than a confirmation, the unconfirmed path would look
    // identical to a confirmed one at the floor and stop escalating.
    let delay = INITIAL_RETRY_MS;
    const observed: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      observed.push(delay);
      delay = activityRetryDelay(delay, false);
    }
    expect(observed).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});
