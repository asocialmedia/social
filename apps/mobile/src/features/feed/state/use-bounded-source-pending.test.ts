import { describe, expect, test } from "bun:test";

import {
  boundedPendingState,
  isHoldingSources,
} from "./use-bounded-source-pending";

describe("boundedPendingState", () => {
  test("holds while a source is pending and the deadline has not passed", () => {
    const waiting = boundedPendingState(
      { expired: false, pending: false },
      true
    );
    expect(waiting).toEqual({ expired: false, pending: true });
    expect(isHoldingSources(waiting)).toBe(true);
  });

  test("releases once the deadline expires", () => {
    expect(isHoldingSources({ expired: true, pending: true })).toBe(false);
  });

  test("an unchanged input keeps the same state object", () => {
    const state = { expired: true, pending: true };
    expect(boundedPendingState(state, true)).toBe(state);
  });

  test("settling resets the clock for the next pending window", () => {
    const settled = boundedPendingState(
      { expired: true, pending: true },
      false
    );
    expect(isHoldingSources(settled)).toBe(false);
    expect(boundedPendingState(settled, true)).toEqual({
      expired: false,
      pending: true,
    });
  });
});
