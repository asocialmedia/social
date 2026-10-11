import { describe, expect, test } from "bun:test";

import { detailsDrawerRadius } from "./details-drawer-radius";

describe("details drawer corners", () => {
  test("flattens gradually between partial and full height", () => {
    expect(
      [320, 240, 160, 80, 0].map((offset) => detailsDrawerRadius(offset, 320))
    ).toEqual([16, 12, 8, 4, 0]);
  });

  test("rounds gradually when returning to partial height", () => {
    expect(
      [0, 80, 160, 240, 320].map((offset) => detailsDrawerRadius(offset, 320))
    ).toEqual([0, 4, 8, 12, 16]);
  });

  test("keeps corners bounded during overscroll and dismissal", () => {
    expect(detailsDrawerRadius(-40, 320)).toBe(0);
    expect(detailsDrawerRadius(640, 320)).toBe(16);
    expect(detailsDrawerRadius(0, 0)).toBe(0);
  });
});
