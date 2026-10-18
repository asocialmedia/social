import { createLogger } from "@asm/logger";

import { authInternalHeaders, getAuthBaseUrl } from "./auth-internal";

const logger = createLogger({ serviceName: "web-account-notices" });

// Server-side trigger for the account-security emails.
//
// These notices are advisory: the action that caused them has already
// committed by the time we call this. So every helper here
//  - resolves instead of throwing, so a mail problem cannot fail the request,
//  - is safe to call without awaiting (fire and forget) from a route that is
//    already returning a success response,
//  - logs the outcome, and the auth service owns the real retries.

export interface NoticeResult {
  ok: boolean;
  error?: string;
}

type Procedure =
  | "notifyAccountMerged"
  | "notifyBackupCodesRegenerated"
  | "notifyEmailChanged"
  | "notifyMessageKeyReset"
  | "notifyNewClientLogin"
  | "notifyPasskeyChanged"
  | "notifyPasswordChanged"
  | "notifySocialAccount"
  | "notifyTwoFactorChanged"
  | "notifyUsernameChanged";

interface InputByProcedure {
  notifyAccountMerged: {
    completedAt: string;
    keptUsername: string;
    mode: "discard" | "merge";
    recipient: string;
    removedUsername: string;
  };
  notifyBackupCodesRegenerated: {
    changedAt: string;
    codeCount: number;
    recipient: string;
  };
  notifyEmailChanged: {
    changedAt: string;
    newEmail: string;
    recipient: string;
  };
  notifyMessageKeyReset: {
    nextStep: string;
    recipient: string;
    resetAt: string;
  };
  notifyPasskeyChanged: {
    action: "added" | "removed";
    changedAt: string;
    passkeyName: string;
    recipient: string;
  };
  notifyNewClientLogin: {
    browser: string;
    city: string | null;
    country: string | null;
    ipAddress: string | null;
    recipient: string;
    signedInAt: string;
  };
  notifyPasswordChanged: {
    changedAt: string;
    recipient: string;
    signedOutEverywhere: boolean;
  };
  notifySocialAccount: {
    accountName: string;
    action: "linked" | "unlinked";
    changedAt: string;
    provider: "bluesky" | "google" | "reddit";
    recipient: string;
  };
  notifyTwoFactorChanged: {
    change: "disabled" | "enabled" | "method-changed";
    changedAt: string;
    method: string;
    recipient: string;
  };
  notifyUsernameChanged: {
    changedAt: string;
    previousUsername: string;
    previousUsernameExpiresAt: string;
    recipient: string;
    username: string;
  };
}

async function callNotice<P extends Procedure>(
  procedure: P,
  input: InputByProcedure[P]
): Promise<NoticeResult> {
  try {
    const response = await fetch(
      `${getAuthBaseUrl()}/api/trpc/email.${procedure}`,
      {
        body: JSON.stringify({ json: input }),
        headers: authInternalHeaders({ "Content-Type": "application/json" }),
        method: "POST",
      }
    );

    if (!response.ok) {
      logger.warn(
        { procedure, status: response.status },
        "account notice request was rejected"
      );
      return { error: `HTTP ${response.status}`, ok: false };
    }

    return { ok: true };
  } catch (error) {
    // A network failure here must never surface: the notice is advisory and the
    // action already succeeded.
    logger.warn(
      {
        error: error instanceof Error ? error.message : "unknown error",
        procedure,
      },
      "account notice request failed"
    );
    return {
      error: error instanceof Error ? error.message : "unknown error",
      ok: false,
    };
  }
}

// The time value every notice carries. ISO-8601 UTC, rendered by the email.
export function noticeTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

export const accountNotices = {
  accountMerged: (input: InputByProcedure["notifyAccountMerged"]) =>
    callNotice("notifyAccountMerged", input),
  backupCodesRegenerated: (
    input: InputByProcedure["notifyBackupCodesRegenerated"]
  ) => callNotice("notifyBackupCodesRegenerated", input),
  emailChanged: (input: InputByProcedure["notifyEmailChanged"]) =>
    callNotice("notifyEmailChanged", input),
  messageKeyReset: (input: InputByProcedure["notifyMessageKeyReset"]) =>
    callNotice("notifyMessageKeyReset", input),
  newClientLogin: (input: InputByProcedure["notifyNewClientLogin"]) =>
    callNotice("notifyNewClientLogin", input),
  passkeyChanged: (input: InputByProcedure["notifyPasskeyChanged"]) =>
    callNotice("notifyPasskeyChanged", input),
  passwordChanged: (input: InputByProcedure["notifyPasswordChanged"]) =>
    callNotice("notifyPasswordChanged", input),
  socialAccount: (input: InputByProcedure["notifySocialAccount"]) =>
    callNotice("notifySocialAccount", input),
  twoFactorChanged: (input: InputByProcedure["notifyTwoFactorChanged"]) =>
    callNotice("notifyTwoFactorChanged", input),
  usernameChanged: (input: InputByProcedure["notifyUsernameChanged"]) =>
    callNotice("notifyUsernameChanged", input),
};

// Fire-and-forget wrapper. Use this on a request path that is about to return
// success: it swallows the promise so a slow auth service cannot add latency.
export function queueNotice(run: () => Promise<NoticeResult>): void {
  // Deliberately not awaited: the caller is about to return success and a slow
  // auth service must not add latency. Errors are logged, never rethrown.
  void (async () => {
    try {
      await run();
    } catch (error: unknown) {
      logger.warn(
        { error: error instanceof Error ? error.message : "unknown error" },
        "account notice dispatch threw"
      );
    }
  })();
}
