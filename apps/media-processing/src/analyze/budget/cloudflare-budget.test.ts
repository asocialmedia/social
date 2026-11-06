import { expect, test } from "bun:test";

import { resolveClefDailyNeurons } from "./cloudflare-budget";

test("paid-sized settings clamp below the free allowance instead of stopping startup", () => {
  expect(resolveClefDailyNeurons("90000")).toBe(9500);
  expect(resolveClefDailyNeurons(10_000)).toBe(9500);
  expect(resolveClefDailyNeurons()).toBe(9000);
  expect(resolveClefDailyNeurons("invalid")).toBe(9000);
});

test("zero disables new provider requests without preventing worker startup", () => {
  expect(resolveClefDailyNeurons("0")).toBe(0);
  expect(resolveClefDailyNeurons(-1)).toBe(0);
  expect(resolveClefDailyNeurons(100.7)).toBe(100);
});
