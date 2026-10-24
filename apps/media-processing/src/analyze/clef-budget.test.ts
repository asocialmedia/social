import { expect, test } from "bun:test";

import { resolveClefDailyBudget } from "./clef-budget";

test.each([undefined, "0", "true", true])(
  "paid usage stays disabled without the explicit flag: %s",
  (flag) => {
    expect(resolveClefDailyBudget("100000", flag)).toBe(10_000);
  }
);

test("paid opt-in preserves a finite daily ceiling", () => {
  expect(resolveClefDailyBudget("100000", "1")).toBe(100_000);
  expect(resolveClefDailyBudget("2000000", "1")).toBe(1_000_000);
  expect(resolveClefDailyBudget("9500", "1")).toBe(9500);
});

test.each([undefined, "", "invalid", "Infinity", "-1", "1.5", "0"])(
  "invalid daily budgets retain the conservative default: %s",
  (value) => {
    expect(resolveClefDailyBudget(value, "1")).toBe(9000);
  }
);
