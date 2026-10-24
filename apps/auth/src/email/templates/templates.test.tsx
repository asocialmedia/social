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

    expect(html).toContain("Verify your email to join asocialmedia");
    expect(html).toContain("http://localhost:3000/verify");
    // The onboarding email leads with the brand lockup, not the old banner.
    expect(html).toContain("email-header-asm.png");
  });

  test("verification email links resolve to real app routes", async () => {
    const html = await getVerificationEmailHtml("http://localhost:3000/verify");

    // Every deep link points at a route the web app actually serves.
    expect(html).toContain("http://localhost:3000/settings?tab=profile");
    expect(html).toContain("http://localhost:3000/discover");
    expect(html).toContain("http://localhost:3000/?tab=trending");
    // /explore was never a route; Explore lives at /discover.
    expect(html).not.toContain("localhost:3000/explore");
  });

  test("verification email ships the real store marks, not inline svg", async () => {
    const html = await getVerificationEmailHtml("http://localhost:3000/verify");

    // Gmail strips inline SVG, so the marks ship as PNGs served from the CDN.
    expect(html).toContain("https://cdn.asocialmedia.cc/email/play-store.png");
    expect(html).toContain("https://cdn.asocialmedia.cc/email/github.png");
    expect(html).not.toContain("<svg");
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
    expect(html).toContain("finish signing in");
  });

  test("code emails use the card shell with a left brand lockup", async () => {
    const otp = await getOTPVerificationEmailHtml("482913");
    const twoFactor = await getTwoFactorOTPEmailHtml("913204");

    for (const html of [otp, twoFactor]) {
      // The framed card: header scene above, meadow below, no legacy banner.
      expect(html).toContain("asm_verification_header.png");
      expect(html).toContain("asm_email_footer.png");
      expect(html).toContain("#f2efe9");
      expect(html).not.toContain("zephyr-githubanner.jpg");
      expect(html).not.toContain("<svg");
      // Footer links are present so the code email is not a dead end.
      expect(html).toContain("/privacy");
      expect(html).toContain("/toc");
      // A support route for "this was not me".
      expect(html).toContain("mailto:hello@asocialmedia.cc");
      // The code emails drop the app-download block and the Singularity Works
      // colophon to stay short.
      expect(html).not.toContain("Get it on");
      expect(html).not.toContain("Singularity Works");
    }
  });

  test("renders password reset email html", async () => {
    const html = await getPasswordResetEmailHtml(
      "http://localhost:3000/reset-password/confirm?token=t"
    );

    expect(html).toContain("Reset your password");
    expect(html).toContain(
      "http://localhost:3000/reset-password/confirm?token=t"
    );
    // On the shared card shell, framed with the enclosed wordmark header and
    // the meadow footer.
    expect(html).toContain("asm_email_header_transactional.png");
    expect(html).toContain("asm_email_footer.png");
    expect(html).not.toContain("zephyr-githubanner.jpg");
    expect(html).not.toContain("<svg");
    // Support route plus the legal footer.
    expect(html).toContain("mailto:hello@asocialmedia.cc");
    expect(html).toContain("/privacy");
    expect(html).toContain("/toc");
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
    //
    // Scoped to the marketing copy on purpose: "Reddit" is a legitimate
    // sign-in provider elsewhere in the config (socialIcons.reddit), and the
    // guard is about the claim that the *feed* aggregates other networks.
    const claims = JSON.stringify({
      features: emailConfig.assets.features,
      project: emailConfig.project,
    }).toLowerCase();

    for (const claim of ["aggregat", "twitter", "reddit", "4chan"]) {
      expect(claims).not.toContain(claim);
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
