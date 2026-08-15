import { validateEmailAdvanced } from "@asm/auth";
import { createLogger } from "@asm/logger";
import { Resend } from "resend";

import { env } from "../../env";
import { emailConfig } from "./config";
import { getPasswordResetEmailHtml } from "./templates/password-reset-email";
import {
  getOTPVerificationEmailHtml,
  getVerificationEmailHtml,
} from "./templates/verification-email";

// Structured pino logger (also shipped to OpenObserve over OTLP when enabled)
// so email send attempts, successes and failures are observable in one place.
const logger = createLogger({ serviceName: "auth-email" });

let resend: Resend | null = null;

export function __resetResend(): void {
  if (process.env.NODE_ENV === "test") {
    resend = null;
  }
}

export function isEmailServiceConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export function isDevelopmentMode(): boolean {
  return env.NODE_ENV === "development";
}

function initializeResend(): void {
  if (!resend) {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required");
    }
    try {
      resend = new Resend(env.RESEND_API_KEY);
    } catch (error) {
      logger.error({ error }, "Failed to initialize Resend");
      throw new Error("Email service initialization failed", {
        cause: error,
      });
    }
  }
}

const SENDER = "asocialmedia.cc";
const FROM_EMAIL = `Zeph <noreply@${SENDER}>`;
const TRAILING_SLASH_REGEX = /\/$/;

function getBaseUrl(): string {
  return env.APP_URL.replace(TRAILING_SLASH_REGEX, "");
}

export interface EmailResult {
  error?: string;
  message?: string;
  skipped?: boolean;
  success: boolean;
  verificationUrl?: string;
}

function getVerificationResult(
  options: Partial<EmailResult> & { success: boolean }
): EmailResult {
  return {
    error: options.error,
    message: options.message,
    skipped: options.skipped,
    success: options.success,
    verificationUrl: options.verificationUrl,
  };
}

function initializeEmailService(): EmailResult | null {
  try {
    initializeResend();
    return null;
  } catch {
    return getVerificationResult({
      error: "Failed to initialize email service",
      success: false,
    });
  }
}

function getVerificationUrl(token: string): string {
  const baseUrl = getBaseUrl().replace(TRAILING_SLASH_REGEX, "");
  return `${baseUrl}/verify-email?token=${token}`;
}

export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<EmailResult> {
  // Skip the DNS MX lookup on the send path: it adds latency and a failure
  // point in containerized environments (the recipient proves ownership by
  // using the emailed link). Basic format + disposable-domain checks remain.
  const validationOptions = {
    skipMxCheck: true,
    skipSmtpCheck: true,
    timeout: 5000,
  };

  const validation = await validateEmailAdvanced(email, validationOptions);

  if (!validation.isValid) {
    logger.warn(
      {
        confidence: validation.confidence,
        disposable: validation.disposable,
        email,
        reasons: validation.reasons,
        score: validation.score,
      },
      "email validation failed"
    );

    return getVerificationResult({
      error: `Email validation failed: ${validation.reasons.join(", ")}`,
      success: false,
    });
  }

  const initResult = initializeEmailService();
  if (initResult) {
    logger.error({ email }, "email service initialization failed");
    return initResult;
  }

  if (!resend) {
    return getVerificationResult({
      error: "Email service not initialized",
      success: false,
    });
  }

  const verificationUrl = getVerificationUrl(token);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      html: await getVerificationEmailHtml(verificationUrl),
      subject: emailConfig.templates.verification.subject,
      to: email,
    });

    if (error) {
      logger.error(
        { email, error: error.message },
        "verification email send failed"
      );
      return getVerificationResult({
        error: error.message || "Failed to send verification email",
        success: false,
        verificationUrl,
      });
    }

    logger.info({ email }, "verification email sent");
    return getVerificationResult({
      success: true,
      verificationUrl,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while sending verification email";

    logger.error({ email, error: errorMessage }, "verification email threw");
    return getVerificationResult({
      error: errorMessage,
      success: false,
      verificationUrl,
    });
  }
}

export async function sendVerificationOTP(
  email: string,
  otp: string
): Promise<EmailResult> {
  // Skip the DNS MX lookup on the send path (see sendVerificationEmail).
  const validationOptions = {
    skipMxCheck: true,
    skipSmtpCheck: true,
    timeout: 5000,
  };

  const validation = await validateEmailAdvanced(email, validationOptions);

  if (!validation.isValid) {
    logger.warn(
      {
        confidence: validation.confidence,
        disposable: validation.disposable,
        email,
        reasons: validation.reasons,
        score: validation.score,
      },
      "email validation failed (otp)"
    );

    return getVerificationResult({
      error: `Email validation failed: ${validation.reasons.join(", ")}`,
      success: false,
    });
  }

  const initResult = initializeEmailService();
  if (initResult) {
    logger.error({ email }, "email service initialization failed (otp)");
    return initResult;
  }

  if (!resend) {
    return getVerificationResult({
      error: "Email service not initialized",
      success: false,
    });
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      html: await getOTPVerificationEmailHtml(otp),
      subject: "Your Verification Code - Asocialmedia",
      to: email,
    });

    if (error) {
      logger.error(
        { email, error: error.message },
        "verification otp send failed"
      );
      return getVerificationResult({
        error: error.message || "Failed to send verification OTP",
        success: false,
      });
    }

    logger.info({ email }, "verification otp sent");
    return getVerificationResult({
      success: true,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while sending verification OTP";

    logger.error({ email, error: errorMessage }, "verification otp threw");
    return getVerificationResult({
      error: errorMessage,
      success: false,
    });
  }
}

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string; resetUrl?: string }> {
  try {
    initializeResend();

    if (!resend) {
      throw new Error("Email service not initialized");
    }

    const baseUrl = getBaseUrl().replace(TRAILING_SLASH_REGEX, "");
    const resetUrl = `${baseUrl}/reset-password/confirm?token=${token}`;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      html: await getPasswordResetEmailHtml(resetUrl),
      subject: emailConfig.templates.passwordReset.subject,
      to: email,
    });

    if (error) {
      logger.error(
        { email, error: error.message },
        "password reset email send failed"
      );
      return {
        error: error.message || "Failed to send password reset email",
        resetUrl: isDevelopmentMode() ? resetUrl : undefined,
        success: false,
      };
    }

    logger.info({ email }, "password reset email sent");
    return {
      resetUrl: isDevelopmentMode() ? resetUrl : undefined,
      success: true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while sending password reset email";

    logger.error({ email, error: errorMessage }, "password reset email threw");
    return {
      error: errorMessage,
      success: false,
    };
  }
}

export function validateEmailServiceConfig(): {
  isValid: boolean;
  message: string;
} {
  if (!env.RESEND_API_KEY) {
    return {
      isValid: false,
      message: "Email service configuration required (RESEND_API_KEY missing)",
    };
  }

  return {
    isValid: true,
    message: "Email service properly configured",
  };
}
