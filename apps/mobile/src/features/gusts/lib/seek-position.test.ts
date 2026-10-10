import { describe, expect, test } from "bun:test";

import { seekRatio } from "./seek-position";

describe("gust scrubbing", () => {
  test("maps horizontal drag to video progress and clamps outside the hit target", () => {
    expect(seekRatio(160, 320)).toBe(0.5);
    expect(seekRatio(-20, 320)).toBe(0);
    expect(seekRatio(340, 320)).toBe(1);
  });
  test("ignores an unmeasured target and invalid coordinates", () => {
    expect(seekRatio(12, 0)).toBe(0);
    expect(seekRatio(Number.NaN, 320)).toBe(0);
    expect(seekRatio(12, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
