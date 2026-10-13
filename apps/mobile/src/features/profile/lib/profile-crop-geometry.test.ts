import { describe, expect, test } from "bun:test";

import { profileCropGeometry, rotatedImageSize } from "./profile-crop-geometry";

const centered = { x: 0, y: 0, zoom: 1 };
describe("profile crop framing", () => {
  test("centers portrait avatars and wide headers without stretching", () => {
    expect(profileCropGeometry(600, 1200, 1, centered)).toEqual({
      height: 600,
      width: 600,
      x: 0,
      y: 300,
    });
    expect(profileCropGeometry(1200, 1200, 3, centered)).toEqual({
      height: 400,
      width: 1200,
      x: 0,
      y: 400,
    });
  });
  test("zoom and edge positioning stay inside the source", () => {
    const crop = profileCropGeometry(1200, 800, 3, { x: 1, y: -1, zoom: 2 });
    expect(crop).toEqual({ height: 200, width: 600, x: 600, y: 0 });
    expect(crop.x + crop.width).toBe(1200);
  });
  test("out-of-range gestures cannot reveal empty pixels", () => {
    const crop = profileCropGeometry(900, 600, 1, { x: -10, y: 10, zoom: 0.5 });
    expect(crop).toEqual({ height: 600, width: 600, x: 0, y: 0 });
  });
  test("quarter turns swap image dimensions without stretching", () => {
    expect(rotatedImageSize(600, 200, 90)).toEqual({ height: 600, width: 200 });
    expect(rotatedImageSize(600, 200, 180)).toEqual({
      height: 200,
      width: 600,
    });
  });
  test("unusable dimensions fail before processing", () => {
    expect(() => profileCropGeometry(0, 500, 1, centered)).toThrow();
  });
});
