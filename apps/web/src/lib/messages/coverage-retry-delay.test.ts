import { describe, expect, test } from "bun:test";

import { coverageRetryDelay } from "./coverage-retry-delay";

describe("coverage retry delay", () => {
  test("backs off from one second to a bounded fifteen-second interval", () => {
    expect([0, 1, 2, 3, 4, 5].map(coverageRetryDelay)).toEqual([
      1000, 2000, 4000, 8000, 15_000, 15_000,
    ]);
    expect(coverageRetryDelay(Number.NaN)).toBe(1000);
  });
});
