#!/usr/bin/env bun
// Renders every email template to standalone HTML in /tmp/opencode/asm-emails
// so the markup can be reviewed in a browser.
//
// The output references the SAME absolute asset URLs the sent email uses
// (cdn.asocialmedia.cc art, asocialmedia.cc fonts and icons). Nothing is
// copied or rewritten, so what you review is exactly what lands in an inbox.
// A blocked or not-yet-deployed asset therefore shows as a broken image here
// too, which is the honest signal.
//
// Usage: bun apps/auth/scripts/render-emails.ts

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = "/tmp/opencode/asm-emails";

rmSync(OUT, { force: true, recursive: true });
mkdirSync(OUT, { recursive: true });

const {
  getVerificationEmailHtml,
  getOTPVerificationEmailHtml,
  getTwoFactorOTPEmailHtml,
} = await import("../src/email/templates/verification-email");
const { getPasswordResetEmailHtml } =
  await import("../src/email/templates/password-reset-email");

const APP = process.env.APP_URL ?? "https://asocialmedia.cc";

const files: Record<string, string> = {
  "otp-verification.html": await getOTPVerificationEmailHtml("482913"),
  "password-reset.html": await getPasswordResetEmailHtml(
    `${APP}/reset-password/confirm?token=sample-reset-token`
  ),
  "two-factor.html": await getTwoFactorOTPEmailHtml("913204"),
  "verification.html": await getVerificationEmailHtml(
    `${APP}/verify-email?token=sample-verification-token`
  ),
};

for (const [name, html] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), html, "utf-8");
  console.log(`${name}  (${html.length} bytes)`);
}

console.log(`\nOpen: file://${OUT}/verification.html`);
