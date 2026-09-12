import { describe, expect, test } from "bun:test";

import {
  getAvailableVerificationMethods,
  getResendCountdown,
} from "@/components/auth/login-form";

describe("getAvailableVerificationMethods", () => {
  test("prioritizes the authenticator app and keeps recovery before email", () => {
    expect(getAvailableVerificationMethods(["otp", "totp"])).toEqual([
      "totp",
      "backup",
      "email",
    ]);
  });

  test("only includes email when it is the sole configured method", () => {
    expect(getAvailableVerificationMethods(["otp"])).toEqual(["email"]);
  });
});

describe("getResendCountdown", () => {
  test("rounds a 30-second resend delay up to whole seconds", () => {
    expect(getResendCountdown(30_000, 1)).toBe(30);
  });

  test("does not return a negative delay after the resend window closes", () => {
    expect(getResendCountdown(30_000, 31_000)).toBe(0);
  });
});
