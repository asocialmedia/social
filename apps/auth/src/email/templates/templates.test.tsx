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
    const html = await getVerificationEmailHtml("http://localhost:3000/verify");

    expect(html).toContain("Verify your email");
    expect(html).toContain("http://localhost:3000/verify");
    expect(html).toContain("zephyr-githubanner.jpg");
  });

  test("verification email component returns JSX", () => {
    const element = VerificationEmail({
      verificationUrl: "http://localhost:3000/verify",
    });

    expect(element).toBeDefined();
  });

  test("renders otp verification email html", async () => {
    const html = await getOTPVerificationEmailHtml("123456");

    expect(html).toContain("Your verification code");
    expect(html).toContain("123456");
    expect(html).toContain("asocialmedia");
  });

  test("otp verification component returns JSX", () => {
    const element = OTPVerificationEmail({ otp: "654321" });

    expect(element).toBeDefined();
  });

  test("renders password reset email html", async () => {
    const html = await getPasswordResetEmailHtml(
      "http://localhost:3000/reset-password/confirm?token=t"
    );

    expect(html).toContain("Password Reset Request");
    expect(html).toContain(
      "http://localhost:3000/reset-password/confirm?token=t"
    );
    expect(html).toContain("zephyr-githubanner.jpg");
  });

  test("password reset component returns JSX", () => {
    const element = PasswordResetEmail({
      resetUrl: "http://localhost:3000/reset-password/confirm?token=t",
    });

    expect(element).toBeDefined();
  });
});
