import { describe, expect, test } from "bun:test";

import { formatNumber, truncateUsername } from "./utils";

describe("truncateUsername", () => {
  test("leaves a username within the budget untouched", () => {
    expect(truncateUsername("nova", 18)).toBe("nova");
    expect(truncateUsername("exactly18chars1234", 18)).toBe(
      "exactly18chars1234"
    );
  });

  test("clips a long username and keeps the result within the budget", () => {
    const long = "a_very_long_username_that_overflows";
    const result = truncateUsername(long, 10);
    expect(result).toBe("a_very_lo…");
    // The ellipsis counts toward the budget, so the result never exceeds it.
    expect(result.length).toBe(10);
  });

  test("degrades gracefully at the boundaries", () => {
    expect(truncateUsername("nova", 0)).toBe("");
    expect(truncateUsername("nova", -3)).toBe("");
    // maxLength 1 can hold only the ellipsis, never a negative slice.
    expect(truncateUsername("nova", 1)).toBe("…");
  });
});

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
