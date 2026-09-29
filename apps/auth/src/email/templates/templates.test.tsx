import { describe, expect, test } from "bun:test";

import { emailConfig } from "../config";
import {
  getPasswordResetEmailHtml,
  PasswordResetEmail,
} from "./password-reset-email";
import {
  getOTPVerificationEmailHtml,
  getTwoFactorOTPEmailHtml,
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

  test("renders two-factor security code html", async () => {
    const html = await getTwoFactorOTPEmailHtml("123456");

    expect(html).toContain("Your security code");
    expect(html).toContain("123456");
    expect(html).toContain("complete your sign-in");
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

  test("verification email closes with the brand line", async () => {
    const html = await getVerificationEmailHtml("http://localhost:3000/verify");

    expect(html).toContain(emailConfig.brandLine);
  });

  test("email config makes no aggregator claims", () => {
    // asocialmedia is not a cross-platform aggregator and never has been. The
    // old copy claimed it pulled Twitter, Reddit and 4chan into one feed, which
    // was false and would ship the moment a template rendered `assets.features`.
    const serialised = JSON.stringify(emailConfig).toLowerCase();

    for (const claim of ["aggregat", "twitter", "reddit", "4chan"]) {
      expect(serialised).not.toContain(claim);
    }
  });

  test("email subjects read as plain English", () => {
    // The verification subject used to be "🎉 One Last Step to Join the
    // asocialmedia!", which puts an article in front of a mass noun.
    expect(emailConfig.templates.verification.subject).toBe(
      "Verify your email to join asocialmedia"
    );
    expect(emailConfig.templates.passwordReset.subject).toBe(
      "Reset your asocialmedia password"
    );
  });
});
