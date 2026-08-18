import { describe, expect, test } from "bun:test";

import { formatNumber } from "./utils";

describe("formatNumber", () => {
  test("renders plain numbers below 1000", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  test("switches to 1k after 1000", () => {
    expect(formatNumber(1000)).toBe("1k");
    expect(formatNumber(1500)).toBe("1.5k");
    expect(formatNumber(999_999)).toBe("1000k");
  });

  test("uses lowercase m for millions and trims .0", () => {
    expect(formatNumber(1_000_000)).toBe("1m");
    expect(formatNumber(1_250_000)).toBe("1.3m");
  });

  test("handles negatives", () => {
    expect(formatNumber(-1000)).toBe("-1k");
  });
});
