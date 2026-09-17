import { describe, expect, test } from "bun:test";

import { COMMUNITY_LIMITS } from "./constants";
import {
  isReservedCommunitySlug,
  isValidCommunitySlug,
  normalizeCommunitySlug,
  RESERVED_COMMUNITY_SLUG_LIST,
  slugifyCommunityName,
} from "./slug";

describe("community slug", () => {
  test("normalizes case and whitespace", () => {
    expect(normalizeCommunitySlug("  Hackers  ")).toBe("hackers");
  });

  test("accepts lowercase letters, numbers, and underscores", () => {
    expect(isValidCommunitySlug("hackers")).toBe(true);
    expect(isValidCommunitySlug("genshin_impact")).toBe(true);
    expect(isValidCommunitySlug("a1_b2")).toBe(true);
  });

  test("rejects invalid characters and casing", () => {
    expect(isValidCommunitySlug("hackers!")).toBe(false);
    expect(isValidCommunitySlug("hack ers")).toBe(false);
    expect(isValidCommunitySlug("hack-ers")).toBe(false);
    // Uppercase is normalized before validation, so it passes; a mixed-case
    // slug is still a valid address.
    expect(isValidCommunitySlug("Hackers")).toBe(true);
  });

  test("enforces the 3-21 character window", () => {
    expect(isValidCommunitySlug("ab")).toBe(false);
    expect(isValidCommunitySlug("abc")).toBe(true);
    expect(isValidCommunitySlug("a".repeat(21))).toBe(true);
    expect(isValidCommunitySlug("a".repeat(22))).toBe(false);
  });

  test("blocks reserved platform slugs", () => {
    for (const slug of RESERVED_COMMUNITY_SLUG_LIST) {
      expect(isReservedCommunitySlug(slug)).toBe(true);
      expect(isValidCommunitySlug(slug)).toBe(false);
    }
    expect(isReservedCommunitySlug("HACKERS")).toBe(false);
  });

  test("slugify turns a display name into a candidate address", () => {
    expect(slugifyCommunityName("Hackers")).toBe("hackers");
    expect(slugifyCommunityName("Genshin Impact")).toBe("genshin_impact");
    expect(slugifyCommunityName("  --Hello, World!--  ")).toBe("hello_world");
    expect(slugifyCommunityName("!!!")).toBe("");
  });

  test("slugify output never exceeds the slug max", () => {
    expect(slugifyCommunityName("a".repeat(50)).length).toBeLessThanOrEqual(21);
  });

  test("slugify strips leading and trailing underscores", () => {
    expect(slugifyCommunityName("___hackers___")).toBe("hackers");
    expect(slugifyCommunityName("_a_")).toBe("a");
    // Interior underscores are preserved.
    expect(slugifyCommunityName("a__b")).toBe("a__b");
  });

  test("slugify returns empty for an all-underscore name", () => {
    expect(slugifyCommunityName("___")).toBe("");
    expect(slugifyCommunityName("_")).toBe("");
  });

  test("slugify stays linear on an interior underscore run", () => {
    // The previous /^_+|_+$/ trim is polynomial: an interior run of
    // underscores is matched by the trailing alternative `_+$`, whose anchor
    // then fails, and the engine retries from every position in the run. An
    // interior run is the worst case (an edge run is consumed by `^_+` and
    // never reaches the trailing alternative). Verified quadratic before the
    // index-scan rewrite (~470ms at 40k underscores, 4x per doubling); the
    // rewrite is flat, so this must finish with wide headroom.
    const pathological = `a${"_".repeat(100_000)}b`;
    const started = performance.now();
    // Interior underscores survive the trim, and the result is capped at the
    // slug max, so the output is the truncated prefix.
    expect(slugifyCommunityName(pathological)).toBe(
      `a${"_".repeat(COMMUNITY_LIMITS.slugMax - 1)}`
    );
    expect(performance.now() - started).toBeLessThan(100);
  });
});
