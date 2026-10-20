import { createAuthConfig } from "@asm/auth/core";
import type { EmailService } from "@asm/auth/core";

import { env } from "../../env";
import {
  notifyNewClientLogin,
  notifySocialAccount,
  notifyTwoFactorChanged,
} from "../email/notify";
import {
  sendPasswordResetEmail,
  sendTwoFactorOTP,
  sendVerificationEmail,
  sendVerificationOTP,
} from "../email/service";

function getTurnstileConfig():
  | { allowedHostnames: string[]; secretKey: string }
  | undefined {
  const secretKey = env.TURNSTILE_SECRET;
  const allowedHostnames = (env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname.length > 0);

  if (!secretKey) {
    if (env.NODE_ENV === "production") {
      throw new Error("TURNSTILE_SECRET must be set in production");
    }
    return undefined;
  }

  if (allowedHostnames.length === 0) {
    if (env.NODE_ENV === "production") {
      throw new Error("TURNSTILE_HOSTNAMES must list at least one hostname");
    }
    return undefined;
  }

  return { allowedHostnames, secretKey };
}

const emailService: EmailService = {
  sendPasswordResetEmail: async (email: string, token: string) => {
    const result = await sendPasswordResetEmail(email, token);
    return {
      error: result.error,
      resetUrl: result.resetUrl,
      success: result.success,
    };
  },
  sendVerificationEmail: async (email: string, token: string) => {
    const result = await sendVerificationEmail(email, token);
    return {
      error: result.error,
      success: result.success,
      verificationUrl: result.verificationUrl,
    };
  },
};

export const auth = createAuthConfig({
  emailService,
  environment: env.NODE_ENV === "test" ? "development" : env.NODE_ENV,
  // Advisory: notify.ts never throws and retries in the background, so linking
  // an account cannot fail because of a mail problem.
  notifyNewClientLogin: ({
    browser,
    city,
    country,
    ipAddress,
    recipient,
    signedInAt,
  }) => {
    notifyNewClientLogin(
      recipient,
      { browser, city, country, ipAddress, signedInAt },
      { source: "session-create-hook" }
    );
  },
  notifySocialAccount: ({ accountName, action, provider, recipient }) => {
    notifySocialAccount(
      recipient,
      {
        accountName,
        action,
        changedAt: new Date().toISOString(),
        provider,
      },
      { source: "account-link-hook" }
    );
  },
  notifyTwoFactorChanged: ({ change, method, recipient }) => {
    notifyTwoFactorChanged(
      recipient,
      { change, changedAt: new Date().toISOString(), method },
      { source: "two-factor-hook" }
    );
  },
  sendTwoFactorOTP: async ({ email, otp }) => {
    const result = await sendTwoFactorOTP(email, otp);
    if (!result.success) {
      throw new Error(result.error || "Failed to send security code");
    }
  },
  sendVerificationOTP: async ({ email, otp, type }) => {
    if (type === "email-verification" || type === "change-email") {
      const result = await sendVerificationOTP(email, otp);
      if (!result.success) {
        throw new Error(result.error || "Failed to send verification OTP");
      }
      return;
    }
    throw new Error(`Unsupported verification type: ${type}`);
  },
  turnstile: getTurnstileConfig(),
});
