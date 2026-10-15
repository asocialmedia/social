import { describe, expect, test } from "bun:test";

import { imageFidelity, passesImageFidelity } from "./fidelity";

describe("perceptual image delivery guard", () => {
  test("identical pixels pass including partial edge blocks", () => {
    const pixels = Uint8Array.from(
      { length: 13 * 17 * 3 },
      (_value, index) => index % 256
    );
    const score = imageFidelity(pixels, pixels, 13, 17);
    expect(score.ssim).toBeCloseTo(1, 8);
    expect(score.psnr).toBe(Infinity);
    expect(passesImageFidelity(score)).toBe(true);
  });
  test("rejects color shifts even when luminance is almost unchanged", () => {
    const reference = Uint8Array.from(
      { length: 16 * 16 * 3 },
      (_value, index) => [255, 0, 0][index % 3] ?? 0
    );
    const shifted = Uint8Array.from(
      { length: reference.length },
      (_value, index) => [0, 76, 0][index % 3] ?? 0
    );
    const score = imageFidelity(reference, shifted, 16, 16);
    expect(score.ssim).toBeGreaterThan(0.99);
    expect(passesImageFidelity(score)).toBe(false);
  });
  test("rejects missing pixels and invalid dimensions", () => {
    expect(() =>
      imageFidelity(new Uint8Array(3), new Uint8Array(6), 1, 1)
    ).toThrow();
    expect(() =>
      imageFidelity(new Uint8Array(), new Uint8Array(), 0, 0)
    ).toThrow();
  });
});
