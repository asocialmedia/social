import { describe, expect, test } from "bun:test";

import { dHash64, parseRate } from "./ffmpeg";

describe("dHash64 perceptual hashing", () => {
  test("uniform pixels hash to zero (no horizontal gradients)", () => {
    const pixels = new Uint8Array(72).fill(128);
    expect(dHash64(pixels)).toBe("0000000000000000");
  });

  test("strict left-to-right gradient sets every bit", () => {
    // Strictly decreasing luminance across all 9 columns makes every
    // horizontal comparison true.
    const pixels = new Uint8Array(8 * 9);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        pixels[y * 9 + x] = Math.max(0, 100 - x * 12);
      }
    }
    expect(dHash64(pixels)).toBe("ffffffffffffffff");
  });

  test("hash is deterministic and sensitive to flips", () => {
    const a = new Uint8Array(72);
    for (let i = 0; i < 9; i += 1) {
      a[i] = i * 20;
    }
    const b = new Uint8Array(a);
    b[4] = 255;
    expect(dHash64(a)).toBe(dHash64(a));
    expect(dHash64(a)).not.toBe(dHash64(b));
  });

  test("bit order is row-major LSB-first", () => {
    // Exactly one true comparison: row 0, x=0.
    const pixels = new Uint8Array(72).fill(10);
    pixels[0] = 20;
    pixels[1] = 10;
    pixels[2] = 10;
    expect(dHash64(pixels)).toBe("0000000000000001");
  });
});

describe("ffmpeg rate parsing", () => {
  test("fractional frame rates", () => {
    expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRate("30/1")).toBe(30);
  });

  test("garbage input yields zero", () => {
    // Via a typed variable: passing a literal undefined gets autofixed to an
    // implicit call by oxlint, which then fails TypeScript's required arity.
    const missing: string | undefined = undefined;
    expect(parseRate(missing)).toBe(0);
    expect(parseRate("")).toBe(0);
    expect(parseRate("N/A")).toBe(0);
    expect(parseRate("5/0")).toBe(0);
  });
});
