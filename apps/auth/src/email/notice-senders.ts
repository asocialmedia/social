import { Resend } from "resend";

import { env } from "../../env";
import { emailConfig } from "./config";
import type { EmailResult } from "./service";
import {
  getAccountMergedEmailHtml,
  getBackupCodesRegeneratedEmailHtml,
  getPasskeyChangedEmailHtml,
  getUsernameChangedEmailHtml,
} from "./templates/credential-notice-emails";
import {
  getEmailChangedEmailHtml,
  getMessageKeyResetEmailHtml,
  getNewClientLoginEmailHtml,
  getPasswordChangedEmailHtml,
  getTwoFactorChangedEmailHtml,
} from "./templates/security-notice-emails";
import { getSocialAccountEmailHtml } from "./templates/social-account-email";

// Delivery for the account-security notices. One module, one Resend client:
// the sequencing policy (retries, logging, never blocking the caller) lives in
// notify.ts, and this file only builds the payload and reports the outcome.

let resend: Resend | null = null;

const FROM = "Zeph <noreply@asocialmedia.cc>";

function client(): Resend {
  resend ??= new Resend(env.RESEND_API_KEY);
  return resend;
}

// Every notice has the same send shape, so the branching is only in the
// subject and the rendered body.
async function deliver(
  to: string,
  subject: string,
  renderHtml: () => Promise<string>
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) {
    return { error: "email service not configured", success: false };
  }

  try {
    const { error } = await client().emails.send({
      from: FROM,
      html: await renderHtml(),
      subject,
      to,
    });

    return error ? { error: error.message, success: false } : { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "unknown error",
      success: false,
    };
  }
}

const { name: brand } = emailConfig.company;

export function sendEmailChangedNotice(
  to: string,
  params: { changedAt: string; newEmail: string }
): Promise<EmailResult> {
  return deliver(to, `Your ${brand} email address was changed`, () =>
    getEmailChangedEmailHtml(params)
  );
}

export function sendPasswordChangedNotice(
  to: string,
  params: { changedAt: string; signedOutEverywhere: boolean }
): Promise<EmailResult> {
  return deliver(to, `Your ${brand} password was changed`, () =>
    getPasswordChangedEmailHtml(params)
  );
}

const TWO_FACTOR_SUBJECT: Record<string, string> = {
  disabled: "Two-factor authentication turned off",
  enabled: "Two-factor authentication turned on",
  "method-changed": "Two-factor authentication changed",
};

export function sendTwoFactorChangedNotice(
  to: string,
  params: {
    change: "disabled" | "enabled" | "method-changed";
    changedAt: string;
    method: string;
  }
): Promise<EmailResult> {
  return deliver(
    to,
    `${TWO_FACTOR_SUBJECT[params.change]} on your ${brand} account`,
    () => getTwoFactorChangedEmailHtml(params)
  );
}

export function sendNewClientLoginNotice(
  to: string,
  params: {
    browser: string;
    city: string | null;
    country: string | null;
    ipAddress: string | null;
    signedInAt: string;
  }
): Promise<EmailResult> {
  return deliver(to, `New sign-in to your ${brand} account`, () =>
    getNewClientLoginEmailHtml(params)
  );
}

export function sendMessageKeyResetNotice(
  to: string,
  params: { nextStep: string; resetAt: string }
): Promise<EmailResult> {
  return deliver(to, `Your ${brand} messages key was reset`, () =>
    getMessageKeyResetEmailHtml(params)
  );
}

const PROVIDER_NAMES = {
  bluesky: "Bluesky",
  google: "Google",
  reddit: "Reddit",
} as const;

export function sendSocialAccountNotice(
  to: string,
  params: {
    accountName: string;
    action: "linked" | "unlinked";
    changedAt: string;
    provider: "bluesky" | "google" | "reddit";
  }
): Promise<EmailResult> {
  const provider = PROVIDER_NAMES[params.provider];
  const verb =
    params.action === "linked" ? "connected to" : "disconnected from";

  return deliver(to, `${provider} ${verb} your ${brand} account`, () =>
    getSocialAccountEmailHtml(params)
  );
}

const PASSKEY_VERB = {
  added: "A passkey was added",
  removed: "A passkey was removed",
} as const;

export function sendPasskeyChangedNotice(
  to: string,
  params: {
    action: "added" | "removed";
    changedAt: string;
    passkeyName: string;
  }
): Promise<EmailResult> {
  return deliver(
    to,
    `${PASSKEY_VERB[params.action]} on your ${brand} account`,
    () => getPasskeyChangedEmailHtml(params)
  );
}

export function sendBackupCodesRegeneratedNotice(
  to: string,
  params: { changedAt: string; codeCount: number }
): Promise<EmailResult> {
  return deliver(to, `Your ${brand} backup codes were regenerated`, () =>
    getBackupCodesRegeneratedEmailHtml(params)
  );
}

export function sendUsernameChangedNotice(
  to: string,
  params: {
    changedAt: string;
    previousUsername: string;
    previousUsernameExpiresAt: string;
    username: string;
  }
): Promise<EmailResult> {
  return deliver(to, `Your ${brand} username was changed`, () =>
    getUsernameChangedEmailHtml(params)
  );
}

export function sendAccountMergedNotice(
  to: string,
  params: {
    completedAt: string;
    keptUsername: string;
    mode: "discard" | "merge";
    removedUsername: string;
  }
): Promise<EmailResult> {
  const subject =
    params.mode === "merge"
      ? `Your ${brand} accounts were merged`
      : `A ${brand} account was discarded`;
  return deliver(to, subject, () => getAccountMergedEmailHtml(params));
}
