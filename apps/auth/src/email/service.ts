import { validateEmailAdvanced } from "@asm/auth";
import { Resend } from "resend";
import { env } from "../../env";
import { emailConfig } from "./config";
import { getPasswordResetEmailHtml } from "./templates/password-reset-email";
import {
  getOTPVerificationEmailHtml,
  getVerificationEmailHtml,
} from "./templates/verification-email";

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
      console.error("Failed to initialize Resend:", error);
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
  return env.NEXT_PUBLIC_URL.replace(TRAILING_SLASH_REGEX, "");
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
    success: options.success,
    verificationUrl: options.verificationUrl,
    error: options.error,
    skipped: options.skipped,
    message: options.message,
  };
}

function initializeEmailService(): EmailResult | null {
  try {
    initializeResend();
    return null;
  } catch {
    return getVerificationResult({
      success: false,
      error: "Failed to initialize email service",
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
  const validationOptions = {
    skipSmtpCheck: true,
    skipMxCheck: false,
    timeout: 5000,
  };

  const validation = await validateEmailAdvanced(email, validationOptions);

  if (!validation.isValid) {
    console.warn(`Email validation failed for ${email}:`, {
      score: validation.score,
      confidence: validation.confidence,
      reasons: validation.reasons,
      disposable: validation.disposable,
    });

    return getVerificationResult({
      success: false,
      error: `Email validation failed: ${validation.reasons.join(", ")}`,
    });
  }

  if (isDevelopmentMode()) {
    console.log(`Email validation passed for ${email}:`, {
      score: validation.score,
      confidence: validation.confidence,
      reasons: validation.reasons,
    });
  }

  const initResult = initializeEmailService();
  if (initResult) {
    return initResult;
  }

  if (!resend) {
    return getVerificationResult({
      success: false,
      error: "Email service not initialized",
    });
  }

  const verificationUrl = getVerificationUrl(token);

  if (isDevelopmentMode()) {
    console.log("Development Mode - Verification URL:", verificationUrl);
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: emailConfig.templates.verification.subject,
      html: await getVerificationEmailHtml(verificationUrl),
    });

    if (error) {
      console.error("Resend error:", error);
      return getVerificationResult({
        success: false,
        verificationUrl,
        error: error.message || "Failed to send verification email",
      });
    }

    return getVerificationResult({
      success: true,
      verificationUrl,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while sending verification email";

    console.error("Error sending verification email:", error);

    return getVerificationResult({
      success: false,
      verificationUrl,
      error: errorMessage,
    });
  }
}

export async function sendVerificationOTP(
  email: string,
  otp: string
): Promise<EmailResult> {
  const validationOptions = {
    skipSmtpCheck: true,
    skipMxCheck: false,
    timeout: 5000,
  };

  const validation = await validateEmailAdvanced(email, validationOptions);

  if (!validation.isValid) {
    console.warn(`Email validation failed for ${email}:`, {
      score: validation.score,
      confidence: validation.confidence,
      reasons: validation.reasons,
      disposable: validation.disposable,
    });

    return getVerificationResult({
      success: false,
      error: `Email validation failed: ${validation.reasons.join(", ")}`,
    });
  }

  if (isDevelopmentMode()) {
    console.log(`Email validation passed for ${email}:`, {
      score: validation.score,
      confidence: validation.confidence,
      reasons: validation.reasons,
    });
  }

  const initResult = initializeEmailService();
  if (initResult) {
    return initResult;
  }

  if (!resend) {
    return getVerificationResult({
      success: false,
      error: "Email service not initialized",
    });
  }

  if (isDevelopmentMode()) {
    console.log(`Development Mode - OTP for ${email}: ${otp}`);
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Your Verification Code - Asocialmedia",
      html: await getOTPVerificationEmailHtml(otp),
    });

    if (error) {
      console.error("Resend error:", error);
      return getVerificationResult({
        success: false,
        error: error.message || "Failed to send verification OTP",
      });
    }

    return getVerificationResult({
      success: true,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while sending verification OTP";

    console.error("Error sending verification OTP:", error);

    return getVerificationResult({
      success: false,
      error: errorMessage,
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

    if (isDevelopmentMode()) {
      console.log("Reset URL:", resetUrl);
    }

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: emailConfig.templates.passwordReset.subject,
      html: await getPasswordResetEmailHtml(resetUrl),
    });

    if (error) {
      console.error("Resend error:", error);
      return {
        success: false,
        error: error.message || "Failed to send password reset email",
        resetUrl: isDevelopmentMode() ? resetUrl : undefined,
      };
    }

    return {
      success: true,
      resetUrl: isDevelopmentMode() ? resetUrl : undefined,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error occurred while sending password reset email";

    console.error("Error sending password reset email:", error);
    return {
      success: false,
      error: errorMessage,
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
