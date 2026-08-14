import { describe, expect, test } from "bun:test";

import { signUpSchema } from "./schemas";

describe("signUpSchema sample validation", () => {
  test("accepts valid signup payload", () => {
    const result = signUpSchema.safeParse({
      email: "hello@example.com",
      password: "ValidPass2026!",
      username: "valid_user_123",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("hello@example.com");
      expect(result.data.username).toBe("valid_user_123");
    }
  });

  test("rejects missing email", () => {
    const result = signUpSchema.safeParse({
      password: "ValidPass2026!",
      username: "valid_user_123",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.format().email?._errors.length).toBeGreaterThan(0);
    }
  });

  test("rejects malformed email", () => {
    const result = signUpSchema.safeParse({
      email: "not-an-email",
      password: "ValidPass2026!",
      username: "valid_user_123",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.format().email?._errors.length).toBeGreaterThan(0);
    }
  });

  test("rejects invalid username", () => {
    const result = signUpSchema.safeParse({
      email: "hello@example.com",
      password: "ValidPass2026!",
      username: "bad user!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.format().username?._errors.length).toBeGreaterThan(0);
    }
  });

  test("rejects short password", () => {
    const result = signUpSchema.safeParse({
      email: "hello@example.com",
      password: "Ab1!",
      username: "valid_user_123",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.format().password?._errors.length).toBeGreaterThan(0);
    }
  });

  test("rejects password missing required classes", () => {
    const result = signUpSchema.safeParse({
      email: "hello@example.com",
      password: "lowercaseonly",
      username: "valid_user_123",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.format().password?._errors.length).toBeGreaterThan(0);
    }
  });
});
