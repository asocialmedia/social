import { describe, expect, test } from "bun:test";

import {
  TWO_FACTOR_METHODS,
  isTwoFactorCodeReady,
  normalizeTwoFactorCode,
  twoFactorMethodCopy,
  twoFactorMethodLabel,
} from "./two-factor";

describe("two-factor methods", () => {
  test("offers email, authenticator and recovery methods", () => {
    expect([...TWO_FACTOR_METHODS]).toEqual(["email", "totp", "backup"]);
    for (const method of TWO_FACTOR_METHODS) {
      expect(twoFactorMethodLabel[method].length).toBeGreaterThan(0);
      expect(twoFactorMethodCopy[method].length).toBeGreaterThan(0);
    }
  });

  test("recovery copy names unused codes like web", () => {
    expect(twoFactorMethodCopy.backup).toContain("unused recovery codes");
  });

  test("trims codes before submit", () => {
    expect(normalizeTwoFactorCode("  123456\n")).toBe("123456");
  });

  test("email and totp are ready at six digits", () => {
    expect(isTwoFactorCodeReady("email", "123456")).toBe(true);
    expect(isTwoFactorCodeReady("totp", "123456")).toBe(true);
    expect(isTwoFactorCodeReady("email", "12345")).toBe(false);
    expect(isTwoFactorCodeReady("totp", "")).toBe(false);
    expect(isTwoFactorCodeReady("email", "12345a")).toBe(false);
  });

  test("recovery codes are ready when non-empty", () => {
    expect(isTwoFactorCodeReady("backup", "abc-def-123")).toBe(true);
    expect(isTwoFactorCodeReady("backup", "   ")).toBe(false);
  });
});
