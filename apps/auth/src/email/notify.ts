import { createLogger } from "@asm/logger";

import { env } from "../../env";
import {
  sendAccountMergedNotice,
  sendBackupCodesRegeneratedNotice,
  sendEmailChangedNotice,
  sendMessageKeyResetNotice,
  sendNewClientLoginNotice,
  sendPasskeyChangedNotice,
  sendPasswordChangedNotice,
  sendSocialAccountNotice,
  sendTwoFactorChangedNotice,
  sendUsernameChangedNotice,
} from "./notice-senders";
import type { EmailResult } from "./service";

const logger = createLogger({ serviceName: "auth-email-notify" });

// Account-security notices are advisory: the action that triggered them has
// already succeeded, so a delivery failure must never surface to the caller or
// undo the change. Every notice therefore goes through here, which
//  - never throws,
//  - retries transient failures with exponential backoff,
//  - logs the outcome with the notice kind and a redacted recipient.

export type NoticeKind =
  | "account-merged"
  | "backup-codes-regenerated"
  | "email-changed"
  | "message-key-reset"
  | "new-client-login"
  | "passkey-changed"
  | "password-changed"
  | "social-account"
  | "two-factor-changed"
  | "username-changed";

export interface NotifyOptions {
  /**
   * Number of attempts. Notices are idempotent and carry no action, so a
   * duplicate is far cheaper than a missed security alert.
   */
  attempts?: number;
  /** Label used in logs to tie a notice back to the flow that sent it. */
  source?: string;
}

const DEFAULT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

// PII handling, matching the transactional senders: never ship a full address.
function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) {
    return email.length > 2 ? `${email.slice(0, 1)}***` : "***";
  }
  const head = local.length > 1 ? local.slice(0, 1) : local;
  return `${head}***@${domain}`;
}

function sleep(ms: number): Promise<void> {
  // A timeout is the only way to back off between attempts.
  // oxlint-disable-next-line promise/avoid-new
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry(
  kind: NoticeKind,
  recipient: string,
  run: () => Promise<EmailResult>,
  options: NotifyOptions
): Promise<EmailResult> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const to = redactEmail(recipient);
  let last: EmailResult = { error: "not attempted", success: false };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design
      last = await run();
    } catch (error) {
      last = {
        error: error instanceof Error ? error.message : "unknown error",
        success: false,
      };
    }

    if (last.success) {
      logger.info(
        { attempt, kind, source: options.source, to },
        "account notice sent"
      );
      return last;
    }

    const isLast = attempt === attempts;
    logger.warn(
      {
        attempt,
        attempts,
        error: last.error,
        kind,
        source: options.source,
        to,
      },
      isLast ? "account notice failed" : "account notice failed, retrying"
    );

    if (!isLast) {
      // oxlint-disable-next-line no-await-in-loop -- backoff between sequential attempts
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  logger.error(
    { attempts, error: last.error, kind, source: options.source, to },
    "account notice dropped after retries"
  );
  return last;
}

// Fire-and-forget entry point. The promise is deliberately not awaited by
// callers, so a slow or failing mail provider cannot hold up a request or
// block a response that already succeeded.
export function notifyEmailChanged(
  recipient: string,
  params: { changedAt: string; newEmail: string },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "email-changed",
    recipient,
    () => sendEmailChangedNotice(recipient, params),
    options
  );
}

export function notifyPasswordChanged(
  recipient: string,
  params: { changedAt: string; signedOutEverywhere: boolean },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "password-changed",
    recipient,
    () => sendPasswordChangedNotice(recipient, params),
    options
  );
}

export function notifyTwoFactorChanged(
  recipient: string,
  params: {
    change: "disabled" | "enabled" | "method-changed";
    changedAt: string;
    method: string;
  },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "two-factor-changed",
    recipient,
    () => sendTwoFactorChangedNotice(recipient, params),
    options
  );
}

export function notifyNewClientLogin(
  recipient: string,
  params: {
    browser: string;
    city: string | null;
    country: string | null;
    ipAddress: string | null;
    signedInAt: string;
  },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "new-client-login",
    recipient,
    () => sendNewClientLoginNotice(recipient, params),
    options
  );
}

export function notifyMessageKeyReset(
  recipient: string,
  params: { nextStep: string; resetAt: string },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "message-key-reset",
    recipient,
    () => sendMessageKeyResetNotice(recipient, params),
    options
  );
}

export function notifySocialAccount(
  recipient: string,
  params: {
    accountName: string;
    action: "linked" | "unlinked";
    changedAt: string;
    provider: "bluesky" | "google" | "reddit";
  },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "social-account",
    recipient,
    () => sendSocialAccountNotice(recipient, params),
    options
  );
}

// Exposed for tests: the retry loop is the part worth asserting on.
export const __internal = { redactEmail, withRetry };

export function isNotifyConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export function notifyPasskeyChanged(
  recipient: string,
  params: {
    action: "added" | "removed";
    changedAt: string;
    passkeyName: string;
  },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "passkey-changed",
    recipient,
    () => sendPasskeyChangedNotice(recipient, params),
    options
  );
}

export function notifyBackupCodesRegenerated(
  recipient: string,
  params: { changedAt: string; codeCount: number },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "backup-codes-regenerated",
    recipient,
    () => sendBackupCodesRegeneratedNotice(recipient, params),
    options
  );
}

export function notifyUsernameChanged(
  recipient: string,
  params: {
    changedAt: string;
    previousUsername: string;
    previousUsernameExpiresAt: string;
    username: string;
  },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "username-changed",
    recipient,
    () => sendUsernameChangedNotice(recipient, params),
    options
  );
}

export function notifyAccountMerged(
  recipient: string,
  params: {
    completedAt: string;
    keptUsername: string;
    mode: "discard" | "merge";
    removedUsername: string;
  },
  options: NotifyOptions = {}
): void {
  void withRetry(
    "account-merged",
    recipient,
    () => sendAccountMergedNotice(recipient, params),
    options
  );
}
