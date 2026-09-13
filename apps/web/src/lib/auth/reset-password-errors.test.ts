import { describe, expect, test } from "bun:test";

import { getResetPasswordErrorMessage } from "./reset-password-errors";

describe("reset-password error messages", () => {
  test("shows the password-safety rejection without leaking arbitrary errors", () => {
    expect(getResetPasswordErrorMessage({ code: "PASSWORD_COMPROMISED" })).toBe(
      "This password has appeared in a data breach. Please choose a different password."
    );
    expect(getResetPasswordErrorMessage({ message: "database details" })).toBe(
      "Couldn't reset your password. Please try again."
    );
  });

  test("explains reset-link and password-length failures", () => {
    expect(getResetPasswordErrorMessage({ code: "INVALID_TOKEN" })).toContain(
      "invalid or has expired"
    );
    expect(getResetPasswordErrorMessage({ code: "PASSWORD_TOO_SHORT" })).toBe(
      "Choose a password with at least 8 characters."
    );
  });
});
