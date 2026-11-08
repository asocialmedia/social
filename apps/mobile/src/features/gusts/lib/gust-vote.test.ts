import { describe, expect, test } from "bun:test";

import { planGustVote } from "./gust-vote";

describe("planGustVote", () => {
  test("up then down sends the down verb from the live value", () => {
    const first = planGustVote({ aura: 10, userVote: 0 }, 1);
    expect(first.target).toBe(1);
    expect(first.next).toEqual({ aura: 11, userVote: 1 });
    // The second tap plans from the first tap's confirmed next value, not
    // the original render snapshot — otherwise a rapid up-then-down would
    // re-POST +1 instead of clearing it.
    const second = planGustVote(first.next, -1);
    expect(second.target).toBe(-1);
    expect(second.toggleOff).toBe(false);
  });

  test("tapping the active value clears it", () => {
    const plan = planGustVote({ aura: 11, userVote: 1 }, 1);
    expect(plan.toggleOff).toBe(true);
    expect(plan.target).toBe(0);
    expect(plan.next).toEqual({ aura: 10, userVote: 0 });
  });

  test("a forced double tap on an amplified gust is a no-op", () => {
    const plan = planGustVote({ aura: 11, userVote: 1 }, 1, true);
    expect(plan.noop).toBe(true);
  });

  test("a forced amplify never un-amplifies", () => {
    const plan = planGustVote({ aura: 9, userVote: -1 }, 1, true);
    expect(plan.noop).toBe(false);
    expect(plan.target).toBe(1);
    expect(plan.toggleOff).toBe(false);
  });
});
