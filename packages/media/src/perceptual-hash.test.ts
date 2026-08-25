import { describe, expect, test } from "bun:test";

import {
  hammingDistanceHex,
  isLikelyDuplicateHash,
  PHASH_MATCH_DISTANCE,
} from "./perceptual-hash";

describe("hammingDistanceHex", () => {
  test("identical hashes have distance 0", () => {
    expect(hammingDistanceHex("0123456789abcdef", "0123456789abcdef")).toBe(0);
  });

  test("counts differing bits across byte boundaries", () => {
    // 0x00 vs 0x01 -> 1 bit; 0xff vs 0x00 -> 8 bits.
    expect(hammingDistanceHex("01", "00")).toBe(1);
    expect(hammingDistanceHex("ff", "00")).toBe(8);
    expect(hammingDistanceHex("ffff", "0000")).toBe(16);
    // Mixed nibble differences: 0xf0 vs 0x0f = 8 bits.
    expect(hammingDistanceHex("f0", "0f")).toBe(8);
  });

  test("is case-insensitive", () => {
    expect(hammingDistanceHex("ABCDEF", "abcdef")).toBe(0);
    expect(hammingDistanceHex("Ab", "ab")).toBe(0);
  });

  test("returns null for incomparable inputs instead of guessing", () => {
    expect(hammingDistanceHex("", "ff")).toBeNull();
    expect(hammingDistanceHex("a", "ab")).toBeNull();
    expect(hammingDistanceHex("zz", "ff")).toBeNull();
    expect(hammingDistanceHex("ff", "fg")).toBeNull();
    // Legacy rows can carry empty phash values.
    expect(hammingDistanceHex("", "")).toBeNull();
  });
});

describe("isLikelyDuplicateHash", () => {
  const base = "0000000000000000";

  test("exact re-encodes (tiny drift) are duplicates", () => {
    // 4 bits apart: a resize/re-compress typically drifts this far.
    const drifted = "000000000000000f";
    expect(isLikelyDuplicateHash(base, drifted)).toBe(true);
    expect(isLikelyDuplicateHash(base, base)).toBe(true);
  });

  test("visually different media stays below threshold-free detection", () => {
    // ~32 bits apart: clearly different images.
    const other = "ffffffff00000000";
    expect(isLikelyDuplicateHash(base, other)).toBe(false);
  });

  test("threshold is strict by default", () => {
    // Half the bits flipped: not a duplicate signal.
    const half = "00000000ffffffff";
    expect(PHASH_MATCH_DISTANCE).toBeLessThanOrEqual(10);
    expect(isLikelyDuplicateHash(base, half)).toBe(false);
  });

  test("incomparable hashes never match", () => {
    expect(isLikelyDuplicateHash(base, "")).toBe(false);
    expect(isLikelyDuplicateHash("", base)).toBe(false);
  });
});
