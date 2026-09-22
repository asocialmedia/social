import { describe, expect, test } from "bun:test";

import { newPasswordSchema, signUpSchema } from "@asm/auth/validation";

import {
  validateIdentifier,
  validateNewPassword,
  validateSignup,
  validateSignupEmail,
  validateUsername,
} from "./auth-validation";

function schemaMessage(outcome: {
  error?: { issues: { message: string }[] };
  success: boolean;
}): string | undefined {
  return outcome.success ? undefined : outcome.error?.issues[0]?.message;
}

describe("auth-validation mirrors @asm/auth/validation", () => {
  const usernames = ["", "  ", "zeph", "Zeph", "bad name!", "ok_user_1"];
  const emails = ["", "not-an-email", "a@b", "user@example.com"];
  const passwords = [
    "",
    "short",
    "alllowercase1!",
    "ALLUPPERCASE1!",
    "NoDigits!!",
    "NoSpecial123",
    "Aaa1!bcdef",
    "Abc1!defgh",
    "Password1!",
    "Str0ng!Pass",
  ];

  test("username copy comes from signUpSchema", () => {
    for (const value of usernames) {
      expect(validateUsername(value)).toBe(
        schemaMessage(signUpSchema.shape.username.safeParse(value))
      );
    }
    expect(validateUsername("")).toBe(
      "Username is required, pick something cool!"
    );
    expect(validateUsername("ok_user_1")).toBeUndefined();
  });

  test("email copy comes from signUpSchema", () => {
    for (const value of emails) {
      expect(validateSignupEmail(value)).toBe(
        schemaMessage(signUpSchema.shape.email.safeParse(value))
      );
    }
    expect(validateSignupEmail("user@example.com")).toBeUndefined();
  });

  test("password copy comes from newPasswordSchema", () => {
    for (const value of passwords) {
      expect(validateNewPassword(value)).toBe(
        schemaMessage(newPasswordSchema.safeParse(value))
      );
    }
    expect(validateNewPassword("Str0ng!Pass")).toBeUndefined();
    expect(validateNewPassword("Password1!")).toBe(
      "'password123' is so last season, pick something better!"
    );
  });

  test("validateSignup collects one message per field", () => {
    expect(
      validateSignup("ok_user_1", "user@example.com", "Str0ng!Pass")
    ).toEqual({});
    const errors = validateSignup("", "nope", "weak");
    expect(errors.username).toBe("Username is required, pick something cool!");
    expect(errors.email).toBe("Please enter a valid email address");
    expect(errors.password).toBe(
      "Password needs at least 8 characters, keep it 100"
    );
  });
});

describe("validateIdentifier", () => {
  test("accepts either a username or an email", () => {
    expect(validateIdentifier("ok_user")).toBeUndefined();
    expect(validateIdentifier("user@example.com")).toBeUndefined();
    expect(validateIdentifier("")).toBe(
      "Please enter your username or email address"
    );
    expect(validateIdentifier("bad name")).toBe(
      "Please enter a valid email address or username"
    );
  });
});
