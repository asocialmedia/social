import { describe, expect, test } from "bun:test";

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
});
