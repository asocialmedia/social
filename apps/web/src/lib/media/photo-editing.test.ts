import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PHOTO_ADJUSTMENTS,
  PHOTO_LOOKS,
  applyPhotoPixels,
  photoPointToSource,
  shouldAutoEditPhoto,
  sourcePointToPhoto,
} from "@asm/ui/lib/photo-editing";
import type { PhotoGeometry } from "@asm/ui/lib/photo-editing";

const original: PhotoGeometry = {
  height: 600,
  naturalHeight: 600,
  naturalWidth: 800,
  width: 800,
  x: 0,
  y: 0,
};

describe("single photo editing", () => {
  test("opens only for one accepted photo selected by itself", () => {
    expect(shouldAutoEditPhoto(1, [{ kind: "image" }])).toBe(true);
    expect(shouldAutoEditPhoto(2, [{ kind: "image" }, { kind: "image" }])).toBe(
      false
    );
    expect(shouldAutoEditPhoto(2, [{ kind: "image" }])).toBe(false);
    expect(shouldAutoEditPhoto(1, [])).toBe(false);
    expect(shouldAutoEditPhoto(1, [{ kind: "video" }])).toBe(false);
    expect(shouldAutoEditPhoto(1, [{ kind: "file" }])).toBe(false);
  });
});

describe("markup coordinates", () => {
  for (const rotate of [0, 90, 180, 270, -90]) {
    for (const scaleX of [1, -1]) {
      test(`round trips a cropped point at rotation ${rotate} and flip ${scaleX}`, () => {
        const geometry = {
          ...original,
          height: 300,
          rotate,
          scaleX,
          width: 400,
          x: 100,
          y: 75,
        };
        const point = { x: 0.23, y: 0.71 };
        const mapped = sourcePointToPhoto(
          photoPointToSource(point, geometry),
          geometry
        );
        expect(mapped.x).toBeCloseTo(point.x, 8);
        expect(mapped.y).toBeCloseTo(point.y, 8);
      });
    }
  }
  test("keeps marks attached after recropping", () => {
    const source = photoPointToSource({ x: 0.5, y: 0.5 }, original);
    const recropped = sourcePointToPhoto(source, {
      ...original,
      height: 300,
      width: 400,
      x: 300,
      y: 150,
    });
    expect(recropped).toEqual({ x: 0.25, y: 0.5 });
  });
  test("rotates the source mark with the image", () => {
    const source = photoPointToSource({ x: 0.25, y: 0.25 }, original);
    const rotated = sourcePointToPhoto(source, {
      ...original,
      height: 800,
      rotate: 90,
      width: 600,
    });
    expect(rotated.x).toBeCloseTo(0.75);
    expect(rotated.y).toBeCloseTo(0.25);
  });
  test("flips the source mark with the image", () => {
    const source = photoPointToSource({ x: 0.25, y: 0.25 }, original);
    const flipped = sourcePointToPhoto(source, { ...original, scaleX: -1 });
    expect(flipped.x).toBeCloseTo(0.75);
    expect(flipped.y).toBeCloseTo(0.25);
  });
});

describe("photo looks", () => {
  test("leaves original pixels and alpha unchanged", () => {
    const pixels = new Uint8ClampedArray([10, 80, 200, 54]);
    applyPhotoPixels(pixels, "original", DEFAULT_PHOTO_ADJUSTMENTS);
    expect([...pixels]).toEqual([10, 80, 200, 54]);
  });
  test("converts mono to equal RGB channels", () => {
    const pixels = new Uint8ClampedArray([230, 100, 10, 128]);
    applyPhotoPixels(pixels, "mono", DEFAULT_PHOTO_ADJUSTMENTS);
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[3]).toBe(128);
  });
  test("warm and cool work in opposite directions", () => {
    const warm = new Uint8ClampedArray([128, 128, 128, 255]);
    const cool = new Uint8ClampedArray(warm);
    applyPhotoPixels(warm, "warm", DEFAULT_PHOTO_ADJUSTMENTS);
    applyPhotoPixels(cool, "cool", DEFAULT_PHOTO_ADJUSTMENTS);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });
  test("adjustments clamp pixels and preserve transparency for every look", () => {
    for (const look of PHOTO_LOOKS) {
      const pixels = new Uint8ClampedArray([0, 128, 255, 0, 255, 0, 128, 200]);
      applyPhotoPixels(pixels, look.id, {
        brightness: 50,
        contrast: 50,
        saturation: 50,
        warmth: -50,
      });
      expect(pixels[3]).toBe(0);
      expect(pixels[7]).toBe(200);
      expect([...pixels].every((value) => value >= 0 && value <= 255)).toBe(
        true
      );
    }
  });
});
