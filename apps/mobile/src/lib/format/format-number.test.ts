import { describe, expect, test } from "bun:test";

import { formatNumber } from "./format-number";

// Mirrors apps/web/src/lib/utils.ts formatNumber, including the ".0" trim.
describe("formatNumber", () => {
  test("leaves values under a thousand alone", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(7)).toBe("7");
    expect(formatNumber(999)).toBe("999");
  });

  test("compacts thousands and trims a trailing zero decimal", () => {
    expect(formatNumber(1000)).toBe("1k");
    expect(formatNumber(1200)).toBe("1.2k");
    expect(formatNumber(2000)).toBe("2k");
    expect(formatNumber(9949)).toBe("9.9k");
  });

  test("compacts millions", () => {
    expect(formatNumber(1_000_000)).toBe("1m");
    expect(formatNumber(2_450_000)).toBe("2.5m");
  });

  test("keeps the sign on negative values", () => {
    expect(formatNumber(-5)).toBe("-5");
    expect(formatNumber(-1500)).toBe("-1.5k");
  });
});
