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
const {
  getEmailChangedEmailHtml,
  getMessageKeyResetEmailHtml,
  getNewClientLoginEmailHtml,
  getPasswordChangedEmailHtml,
  getTwoFactorChangedEmailHtml,
} = await import("../src/email/templates/security-notice-emails");
const { getSocialAccountEmailHtml } =
  await import("../src/email/templates/social-account-email");
const {
  getAccountMergedEmailHtml,
  getBackupCodesRegeneratedEmailHtml,
  getPasskeyChangedEmailHtml,
  getUsernameChangedEmailHtml,
} = await import("../src/email/templates/credential-notice-emails");

const APP = process.env.APP_URL ?? "https://asocialmedia.cc";
const SAMPLE_TIME = "18 October 2026 at 14:32 UTC";

const files: Record<string, string> = {
  "account-merged.html": await getAccountMergedEmailHtml({
    completedAt: SAMPLE_TIME,
    keptUsername: "parazeeknova",
    mode: "merge",
    removedUsername: "old.handle",
  }),
  "backup-codes-regenerated.html": await getBackupCodesRegeneratedEmailHtml({
    changedAt: SAMPLE_TIME,
    codeCount: 10,
  }),
  "email-changed.html": await getEmailChangedEmailHtml({
    changedAt: SAMPLE_TIME,
    newEmail: "new.address@example.com",
  }),
  "message-key-reset.html": await getMessageKeyResetEmailHtml({
    nextStep: "Created the next time you open Messages",
    resetAt: SAMPLE_TIME,
  }),
  "new-client-login.html": await getNewClientLoginEmailHtml({
    browser: "Firefox on macOS",
    city: "Bhopal",
    country: "India",
    ipAddress: "203.0.113.42",
    signedInAt: SAMPLE_TIME,
  }),
  "otp-verification.html": await getOTPVerificationEmailHtml("482913"),
  "passkey-changed.html": await getPasskeyChangedEmailHtml({
    action: "added",
    changedAt: SAMPLE_TIME,
    passkeyName: "MacBook Touch ID",
  }),
  "password-changed.html": await getPasswordChangedEmailHtml({
    changedAt: SAMPLE_TIME,
    signedOutEverywhere: true,
  }),
  "password-reset.html": await getPasswordResetEmailHtml(
    `${APP}/reset-password/confirm?token=sample-reset-token`
  ),
  "social-bluesky-linked.html": await getSocialAccountEmailHtml({
    accountName: "@zeph.bsky.social",
    action: "linked",
    changedAt: SAMPLE_TIME,
    provider: "bluesky",
  }),
  "social-google-linked.html": await getSocialAccountEmailHtml({
    accountName: "hello@asocialmedia.cc",
    action: "linked",
    changedAt: SAMPLE_TIME,
    provider: "google",
  }),
  "social-reddit-unlinked.html": await getSocialAccountEmailHtml({
    accountName: "u/parazeeknova",
    action: "unlinked",
    changedAt: SAMPLE_TIME,
    provider: "reddit",
  }),
  "two-factor-changed.html": await getTwoFactorChangedEmailHtml({
    change: "enabled",
    changedAt: SAMPLE_TIME,
    method: "Authenticator app and email codes",
  }),
  "two-factor.html": await getTwoFactorOTPEmailHtml("913204"),
  "username-changed.html": await getUsernameChangedEmailHtml({
    changedAt: SAMPLE_TIME,
    previousUsername: "zephyr",
    previousUsernameExpiresAt: "17 November 2026 at 14:32 UTC",
    username: "parazeeknova",
  }),
  "verification.html": await getVerificationEmailHtml(
    `${APP}/verify-email?token=sample-verification-token`
  ),
};

for (const [name, html] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), html, "utf-8");
  console.log(`${name}  (${html.length} bytes)`);
}

console.log(`\nOpen: file://${OUT}/verification.html`);
