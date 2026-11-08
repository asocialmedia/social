import { describe, expect, test } from "bun:test";

import {
  DEN_BAN_REASON_LABEL,
  DEN_BAN_REASON_MAX,
  DEN_LIMITS,
  normalizeDenBanReason,
  normalizeDenName,
  validateDenDescription,
  validateDenName,
} from "./den-forms";

describe("den name rules", () => {
  test("normalizes cosmetic spacing away", () => {
    expect(normalizeDenName("  game   night ")).toBe("game night");
  });

  test("requires a name and caps it at the limit", () => {
    expect(validateDenName("   ")).toBe("Den name is required");
    expect(validateDenName("a".repeat(DEN_LIMITS.nameMax))).toBeNull();
    expect(validateDenName("a".repeat(DEN_LIMITS.nameMax + 1))).toBe(
      `Den name must be ${DEN_LIMITS.nameMax} characters or fewer`
    );
  });

  test("an empty description is valid; an over-long one names the cap", () => {
    expect(validateDenDescription("")).toBeNull();
    expect(validateDenDescription("  ")).toBeNull();
    expect(
      validateDenDescription("a".repeat(DEN_LIMITS.descriptionMax + 1))
    ).toBe(
      `Description must be ${DEN_LIMITS.descriptionMax} characters or fewer`
    );
  });

  test("the limits mirror the server policies", () => {
    expect(DEN_LIMITS.nameMax).toBe(64);
    expect(DEN_LIMITS.descriptionMax).toBe(280);
    expect(DEN_LIMITS.membersMax).toBe(100);
    expect(DEN_LIMITS.membersMin).toBe(2);
  });
});

describe("ban reason rules", () => {
  test("empty trims to null and long notes slice to the cap", () => {
    expect(normalizeDenBanReason("   ")).toBeNull();
    expect(normalizeDenBanReason("keep")).toBe("keep");
    expect(normalizeDenBanReason("a".repeat(DEN_BAN_REASON_MAX + 10))).toBe(
      "a".repeat(DEN_BAN_REASON_MAX)
    );
    expect(DEN_BAN_REASON_MAX).toBe(140);
    expect(DEN_BAN_REASON_LABEL).toContain("owners and Elders");
  });
});
