import { describe, expect, it } from "bun:test";

import { nextExpiryDelayMs } from "./incognito-expiry";

describe("nextExpiryDelayMs", () => {
  it("returns null when nothing expires", () => {
    expect(nextExpiryDelayMs([], 1000)).toBeNull();
  });

  it("returns the delay to the soonest future expiry", () => {
    expect(nextExpiryDelayMs([5000, 2000, 9000], 1000)).toBe(1000);
  });

  it("returns zero when an expiry is already due", () => {
    expect(nextExpiryDelayMs([500, 9000], 1000)).toBe(0);
  });
});
