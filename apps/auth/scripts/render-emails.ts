#!/usr/bin/env bun
// Renders every email template to standalone HTML in /tmp/opencode/asm-emails.
//
// Two outputs are written:
//   *.html          - canonical markup with the real https:// asset URLs, i.e.
//                     exactly what Resend would send.
//   preview/*.html  - the same markup with asset URLs rewritten to relative
//                     paths and the assets copied alongside, so the design can
//                     be opened offline with file:// and reviewed with no
//                     server, no deploy and no mail client.
//
// Usage: bun apps/auth/scripts/render-emails.ts

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = "/tmp/opencode/asm-emails";
const PREVIEW = path.join(OUT, "preview");
const REPO = path.resolve(import.meta.dir, "../../..");
const WEB_PUBLIC = path.join(REPO, "apps/web/public");

rmSync(OUT, { force: true, recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(PREVIEW, { recursive: true });

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

// Only same-origin assets (icons, fonts) move into the preview; the CDN banner
// and hero stay remote because they are hotlinked in production too.
const LOCAL_ASSET_PREFIXES = ["/brand/email/", "/fonts/"];

function toPreview(html: string): string {
  let out = html;
  for (const prefix of LOCAL_ASSET_PREFIXES) {
    out = out.replaceAll(`${APP}${prefix}`, `.${prefix}`);
  }
  // Point the visible links at the production site so the copy reads true.
  return out.replaceAll(APP, "https://asocialmedia.cc");
}

for (const [name, html] of Object.entries(files)) {
  writeFileSync(path.join(OUT, name), html, "utf-8");
  writeFileSync(path.join(PREVIEW, name), toPreview(html), "utf-8");
  console.log(`${name}  (${html.length} bytes)`);
}

// Copy the assets the preview references, preserving their served paths.
cpSync(
  path.join(WEB_PUBLIC, "brand/email"),
  path.join(PREVIEW, "brand/email"),
  { recursive: true }
);
cpSync(path.join(WEB_PUBLIC, "fonts"), path.join(PREVIEW, "fonts"), {
  recursive: true,
});

console.log(`\nCanonical: ${OUT}`);
console.log(`Preview:   file://${PREVIEW}/verification.html`);
