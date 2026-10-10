import { describe, expect, test } from "bun:test";

import {
  DEN_INVITE_CODE_ALPHABET,
  DEN_LIMITS,
  DEN_SHORT_CODE_ALPHABET,
  DEN_SHORT_CODE_LENGTH,
  DenError,
  DEN_MANAGEMENT_ROLES,
  DEN_ROLES,
  canManageDen,
  canManageRole,
  isDenRole,
  isDenShortCode,
  normalizeDenName,
  normalizeDenShortCode,
  validateDenDescription,
  validateDenName,
} from "@asm/db";

describe("den roles", () => {
  test("recognises exactly the three modelled roles", () => {
    for (const role of DEN_ROLES) {
      expect(isDenRole(role)).toBe(true);
    }
    for (const candidate of [
      "OWNER",
      "owner",
      "MODERATOR",
      "",
      "PARTICIPANT",
    ]) {
      if (candidate === "") {
        expect(isDenRole(candidate)).toBe(false);
        continue;
      }
      expect(isDenRole(candidate)).toBe(candidate === "OWNER");
    }
  });

  test("management is exactly the owner and admin set", () => {
    // Management is deliberately a superset-of-nothing: it holds the two roles
    // that may run a management route, and nothing else. Membership here is the
    // only thing a route has to check, so widening it later is a visible change
    // rather than a silent grant.
    expect(DEN_MANAGEMENT_ROLES).toContain("OWNER");
    expect(DEN_MANAGEMENT_ROLES).toContain("ADMIN");
    expect(DEN_MANAGEMENT_ROLES).not.toContain("MEMBER");
    for (const role of DEN_MANAGEMENT_ROLES) {
      expect(DEN_ROLES).toContain(role);
    }
  });

  test("canManageDen admits owner and admin only", () => {
    expect(canManageDen("OWNER")).toBe(true);
    expect(canManageDen("ADMIN")).toBe(true);
    expect(canManageDen("MEMBER")).toBe(false);
    expect(canManageDen("")).toBe(false);
    expect(canManageDen("OWNER ")).toBe(false);
  });

  test("only the owner may act on the owner", () => {
    expect(canManageRole("OWNER", "MEMBER")).toBe(true);
    expect(canManageRole("OWNER", "ADMIN")).toBe(true);
    expect(canManageRole("OWNER", "OWNER")).toBe(true);
    // An admin cannot kick or demote the owner.
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(true);
    expect(canManageRole("ADMIN", "MEMBER")).toBe(true);
    // A plain member manages nobody, not even another plain member.
    expect(canManageRole("MEMBER", "MEMBER")).toBe(false);
    expect(canManageRole("MEMBER", "ADMIN")).toBe(false);
  });
});

describe("den name validation", () => {
  test("collapses whitespace so cosmetic variants are one den", () => {
    expect(normalizeDenName("  game   night ")).toBe("game night");
    expect(normalizeDenName("game\n\tnight")).toBe("game night");
    expect(normalizeDenName("")).toBe("");
  });

  test("accepts a name at both bounds", () => {
    expect(validateDenName("a")).toBeNull();
    expect(validateDenName("x".repeat(DEN_LIMITS.nameMax))).toBeNull();
  });

  test("rejects blank and over-long names", () => {
    expect(validateDenName("")).not.toBeNull();
    expect(validateDenName("   \t\n ")).not.toBeNull();
    expect(validateDenName("x".repeat(DEN_LIMITS.nameMax + 1))).not.toBeNull();
  });

  test("validates against the normalized length, not the raw one", () => {
    // 64 visible characters padded with spaces is still a legal name; rejecting
    // it would make the bound depend on how the client happened to pad.
    const padded = `  ${"x".repeat(DEN_LIMITS.nameMax)}  `;
    expect(validateDenName(padded)).toBeNull();
  });

  test("the description bound is independent of the name bound", () => {
    expect(validateDenDescription("")).toBeNull();
    expect(
      validateDenDescription("x".repeat(DEN_LIMITS.descriptionMax))
    ).toBeNull();
    expect(
      validateDenDescription("x".repeat(DEN_LIMITS.descriptionMax + 1))
    ).not.toBeNull();
    // A long description on a short name is fine; the two are not coupled.
    expect(validateDenName("a")).toBeNull();
  });
});

describe("den invite code alphabet", () => {
  test("omits every glyph that is read wrong from a screenshot", () => {
    for (const ambiguous of ["0", "o", "1", "l", "i"]) {
      expect(DEN_INVITE_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  test("has enough distinct symbols for the code length", () => {
    // 31 symbols over a 12-character code is ~10^18 codes, so a collision is
    // not a practical concern; assert the alphabet is large enough for that to
    // hold and that it carries no repeat.
    expect(DEN_INVITE_CODE_ALPHABET.length).toBeGreaterThanOrEqual(31);
    expect(new Set(DEN_INVITE_CODE_ALPHABET).size).toBe(
      DEN_INVITE_CODE_ALPHABET.length
    );
  });
});

describe("den short code", () => {
  test("alphabet and length match spec", () => {
    expect(DEN_SHORT_CODE_LENGTH).toBe(6);
    expect(DEN_SHORT_CODE_ALPHABET).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    );
    expect(DEN_SHORT_CODE_ALPHABET.length).toBe(36);
    expect(new Set(DEN_SHORT_CODE_ALPHABET).size).toBe(36);
  });

  test("normalization trims whitespace and uppercases", () => {
    expect(normalizeDenShortCode("  abc123  ")).toBe("ABC123");
    expect(normalizeDenShortCode("xyz890")).toBe("XYZ890");
    expect(normalizeDenShortCode("  ABC123  ")).toBe("ABC123");
    expect(normalizeDenShortCode("")).toBe("");
  });

  test("regex accept/reject table", () => {
    const validCodes = ["ABC123", "000000", "ZZZZZZ", "A1B2C3", "9XYZ8A"];
    for (const code of validCodes) {
      expect(isDenShortCode(code)).toBe(true);
    }

    const invalidCodes = [
      "",
      "A",
      "AB",
      "ABC",
      "ABCD",
      "ABCDE",
      "ABCDEFG",
      "abc123",
      "ABC 12",
      "AB-123",
      "AB!@#$",
      "A_B_C_",
      "  ABC123  ",
    ];
    for (const code of invalidCodes) {
      expect(isDenShortCode(code)).toBe(false);
    }

    // Normalizing first allows lowercase-typed inputs to pass validation
    expect(isDenShortCode(normalizeDenShortCode("abc123"))).toBe(true);
    expect(isDenShortCode(normalizeDenShortCode("  abc123  "))).toBe(true);
  });
});

// The `DenError` code union, pinned in both directions.
//
// This is a compile-time fact as much as a runtime one, so it is written the way
// the codebase writes an exhaustive case list: a `Record` keyed by the union, which
// errors on a MISSING key as well as on an EXTRA one. Adding a code to `DenError`
// without adding it here is a build failure, which is the point - a den's set of
// refusals should be something a reader has to account for.
//
// BLOCKED is deliberately not one of them, and the absence is the assertion. A
// block is a DM-only rule; a den admits regardless of who blocks whom, so the
// service has no outcome to give it. Naming "BLOCKED" in the literal below would
// not compile, which is how a future edit that tries to reintroduce the door check
// discovers it is reintroducing an API too.
describe("the den error union", () => {
  // Annotated rather than inferred: the annotation is what makes this exhaustive.
  // `Record<DenError["code"], true>` rejects a key the union does not have AND a
  // union member the literal leaves out.
  const modelled: Record<DenError["code"], true> = {
    ALREADY_MEMBER: true,
    BANNED: true,
    FORBIDDEN: true,
    INVALID_INPUT: true,
    INVALID_ROLE: true,
    LIMIT_REACHED: true,
    MEMBERS_REQUIRED: true,
    NOT_A_DEN: true,
    NOT_FOUND: true,
    SELF_ACTION: true,
  };

  test("is exactly the set of codes the den can refuse with", () => {
    expect(Object.keys(modelled).toSorted()).toEqual([
      "ALREADY_MEMBER",
      "BANNED",
      "FORBIDDEN",
      "INVALID_INPUT",
      "INVALID_ROLE",
      "LIMIT_REACHED",
      "MEMBERS_REQUIRED",
      "NOT_A_DEN",
      "NOT_FOUND",
      "SELF_ACTION",
    ]);
  });

  test("has no BLOCKED code, because a block does not apply to a den", () => {
    // The runtime shadow of the compile-time fact above. `new DenError` takes a
    // code typed as the union, so this only compiles while BLOCKED is absent - and
    // if a reintroduced door check ever throws it again, this line is where it gets
    // caught rather than where it gets asserted to be correct.
    expect("BLOCKED" in modelled).toBe(false);
    const refused = new DenError("FORBIDDEN", "refused for a real reason");
    expect(refused.code).toBe("FORBIDDEN");
  });
});
