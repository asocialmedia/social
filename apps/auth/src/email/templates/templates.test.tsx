import { describe, expect, test } from "bun:test";

import {
  getPasswordResetEmailHtml,
  PasswordResetEmail,
} from "./password-reset-email";
import {
  getOTPVerificationEmailHtml,
  getVerificationEmailHtml,
  OTPVerificationEmail,
  VerificationEmail,
} from "./verification-email";

describe("email templates", () => {
  test("renders verification email html", async () => {
    const html = await getVerificationEmailHtml(
      "https://social.localhost/verify"
    );

    expect(html).toContain("Verify your email");
    expect(html).toContain("https://social.localhost/verify");
    expect(html).toContain("Verify Email Address");
  });

  test("verification email component returns JSX", () => {
    const element = VerificationEmail({
      verificationUrl: "https://social.localhost/verify",
    });

    expect(element).toBeDefined();
  });

  test("renders otp verification email html", async () => {
    const html = await getOTPVerificationEmailHtml("123456");

    expect(html).toContain("Your verification code");
    expect(html).toContain("123456");
    expect(html).toContain("Asocialmedia");
  });

  test("otp verification component returns JSX", () => {
    const element = OTPVerificationEmail({ otp: "654321" });

    expect(element).toBeDefined();
  });

  test("renders password reset email html", async () => {
    const html = await getPasswordResetEmailHtml(
      "https://social.localhost/reset-password/confirm?token=t"
    );

    expect(html).toContain("Password Reset Request");
    expect(html).toContain("Reset Password");
    expect(html).toContain(
      "https://social.localhost/reset-password/confirm?token=t"
    );
  });

  test("password reset component returns JSX", () => {
    const element = PasswordResetEmail({
      resetUrl: "https://social.localhost/reset-password/confirm?token=t",
    });

    expect(element).toBeDefined();
  });
});
