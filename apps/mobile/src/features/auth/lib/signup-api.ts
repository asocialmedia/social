// Signup + email-verification calls against the web origin.
//
// The web app runs these as Server Actions, which a native client cannot
// invoke, so the native flow uses the route handlers behind them:
//   POST /api/signup       - Turnstile-verified account creation
//   POST /api/verify-email - OTP/enumeration-safe email verification
// Both are exempt from the install-token gate precisely because they carry
// their own defences (a Turnstile challenge and the auth service's OTP
// budgets), so a new user never faces two challenges to sign up.

import { getApiBaseUrl } from "@/lib/api-env";
import { logError } from "@/lib/telemetry";

const REQUEST_TIMEOUT_MS = 25_000;

async function postJson<T>(
  path: string,
  body: unknown
): Promise<{ data: T | null; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return { data, ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

export interface SignupResult {
  error?: string;
  ok: boolean;
  requiresEmailVerification?: boolean;
}

interface SignupResponse {
  error?: string;
  message?: string;
  requiresEmailVerification?: boolean;
  success?: boolean;
}

/** Creates the account. On success the caller moves to the OTP step. */
export async function requestSignup(values: {
  email: string;
  password: string;
  turnstileToken: string;
  username: string;
}): Promise<SignupResult> {
  try {
    const { data, ok } = await postJson<SignupResponse>("/api/signup", values);
    if (!ok || data?.success !== true) {
      return {
        error: data?.error ?? data?.message ?? "Signup failed. Try again?",
        ok: false,
      };
    }
    return {
      ok: true,
      requiresEmailVerification: data.requiresEmailVerification !== false,
    };
  } catch (error) {
    logError("signup.request_failed", error);
    return {
      error: "Couldn't reach the server. Check your connection and try again.",
      ok: false,
    };
  }
}

export interface OtpVerifyResult {
  error?: string;
  ok: boolean;
}

interface OtpResponse {
  error?: string;
  ok?: boolean;
  success?: boolean;
}

/** Confirms the emailed OTP. Success means the account is verified. */
export async function verifySignupOtp(
  email: string,
  otp: string
): Promise<OtpVerifyResult> {
  try {
    const { data, ok } = await postJson<OtpResponse>("/api/verify-email", {
      email,
      otp,
    });
    const verified = ok && (data?.ok === true || data?.success === true);
    if (!verified) {
      return {
        error: data?.error ?? "That code didn't match. Check and try again.",
        ok: false,
      };
    }
    return { ok: true };
  } catch (error) {
    logError("signup.otp_verify_failed", error);
    return {
      error: "Couldn't reach the server. Check your connection and try again.",
      ok: false,
    };
  }
}

interface ResendResponse {
  error?: string;
  rateLimited?: boolean;
  success?: boolean;
}

/** Re-sends the verification code. Rate-limited by the auth service. */
export async function resendSignupOtp(email: string): Promise<OtpVerifyResult> {
  try {
    const { data, ok } = await postJson<ResendResponse>("/api/signup/resend", {
      email,
    });
    if (!ok || data?.success !== true) {
      return {
        error:
          data?.error ??
          "Couldn't send a new code. Give it a moment and try again.",
        ok: false,
      };
    }
    return { ok: true };
  } catch (error) {
    logError("signup.otp_resend_failed", error);
    return {
      error: "Couldn't reach the server. Check your connection and try again.",
      ok: false,
    };
  }
}
