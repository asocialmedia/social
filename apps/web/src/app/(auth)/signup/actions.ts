"use server";

import { env } from "@root/env";

import { authInternalHeaders } from "@/lib/auth-internal";

const RATE_LIMIT_ERROR = "rate-limited";

function handleRateLimitError(
  data: unknown,
  userMessage: string
): {
  success: false;
  rateLimited: true;
  error: string;
  rateLimitInfo?: { remaining: number; resetTime: number };
} {
  const rateLimitInfo = (
    data as
      | {
          result?: {
            data?: { json?: { remaining?: number; resetTime?: number } };
          };
        }
      | undefined
  )?.result?.data?.json;
  return {
    error: userMessage,
    rateLimitInfo: rateLimitInfo
      ? {
          remaining: rateLimitInfo.remaining || 0,
          resetTime: rateLimitInfo.resetTime || 0,
        }
      : undefined,
    rateLimited: true,
    success: false,
  };
}

interface SignUpResponse {
  emailVerification?: {
    email: string;
    isNewToken: boolean;
  };
  error?: string;
  message?: string;
  rateLimited?: boolean;
  rateLimitInfo?: {
    remaining: number;
    resetTime: number;
  };
  requiresEmailVerification?: boolean;
  success: boolean;
}

export async function signUp(credentials: {
  username: string;
  email: string;
  password: string;
}): Promise<SignUpResponse> {
  try {
    const authBase = env.NEXT_PUBLIC_AUTH_URL;
    const res = await fetch(`${authBase}/api/trpc/pendingSignupStart`, {
      body: JSON.stringify({
        id: 1,
        json: {
          displayName: credentials.username,
          email: credentials.email,
          password: credentials.password,
          username: credentials.username,
        },
      }),
      credentials: "include",
      headers: authInternalHeaders({ "content-type": "application/json" }),
      method: "POST",
    });
    const data = await res.json().catch(() => ({}) as unknown);

    if (!res.ok) {
      const err = data?.message || data?.error || "HTTP request failed";
      return { error: String(err), success: false };
    }

    const resultJson = data?.result?.data?.json;
    const ok = resultJson?.success === true;
    if (!ok) {
      const userFacingMessage = resultJson?.message;
      const err =
        data?.result?.error?.message ||
        data?.error?.message ||
        resultJson?.error ||
        data?.result?.data?.error ||
        data?.error ||
        "Signup failed";

      if (String(err) === "user-exists") {
        return {
          error:
            userFacingMessage ||
            "An account with this email or username already exists. Try logging in or reset your password.",
          success: false,
        };
      }

      if (String(err) === RATE_LIMIT_ERROR) {
        return handleRateLimitError(
          data,
          "Whoa there, speed racer! You've hit the signup limit. Take a break and try again later."
        );
      }

      return { error: String(err), success: false };
    }

    return {
      message:
        resultJson?.requiresEmailVerification === false
          ? "Account created. Redirecting..."
          : "Pending signup created. Please check your email to verify your address.",
      requiresEmailVerification:
        resultJson?.requiresEmailVerification !== false,
      success: true,
      ...(resultJson?.requiresEmailVerification === false
        ? {}
        : {
            emailVerification: {
              email: credentials.email,
              isNewToken: true,
            },
          }),
    };
  } catch (error) {
    console.error("Signup error:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      success: false,
    };
  }
}

export async function resendVerificationEmail(email: string): Promise<{
  success: boolean;
  error?: string;
  rateLimited?: boolean;
  rateLimitInfo?: {
    remaining: number;
    resetTime: number;
  };
}> {
  try {
    const authBase = env.NEXT_PUBLIC_AUTH_URL;
    const res = await fetch(`${authBase}/api/trpc/pendingSignupResend`, {
      body: JSON.stringify({ id: 1, json: { email } }),
      credentials: "include",
      headers: authInternalHeaders({ "content-type": "application/json" }),
      method: "POST",
    });
    const data = await res.json().catch(() => ({}) as unknown);
    const ok = data?.result?.data?.success === true || data?.success === true;
    if (!ok) {
      const err =
        data?.error?.message ||
        data?.result?.error?.message ||
        data?.result?.data?.error ||
        data?.error ||
        "Failed to resend verification email";

      if (String(err) === RATE_LIMIT_ERROR) {
        return handleRateLimitError(
          data,
          "Easy there, trigger finger! You've requested too many codes. Give it a moment and try again."
        );
      }

      return { error: String(err), success: false };
    }
    return { success: true };
  } catch (error) {
    console.error("Resend verification email error:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to resend verification email",
      success: false,
    };
  }
}

export async function verifyOTP(
  email: string,
  otp: string
): Promise<{
  success: boolean;
  error?: string;
  rateLimited?: boolean;
  rateLimitInfo?: {
    remaining: number;
    resetTime: number;
  };
}> {
  try {
    const authBase = env.NEXT_PUBLIC_AUTH_URL;
    const res = await fetch(`${authBase}/api/auth/email-otp/verify-email`, {
      body: JSON.stringify({ email, otp }),
      credentials: "include",
      headers: authInternalHeaders({ "content-type": "application/json" }),
      method: "POST",
    });
    const data = await res.json().catch(() => ({}) as unknown);

    if (!res.ok) {
      const err = data?.message || data?.error || "OTP verification failed";

      if (String(err) === RATE_LIMIT_ERROR) {
        const rateLimitInfo = (
          data as
            | { json?: { remaining?: number; resetTime?: number } }
            | undefined
        )?.json;
        return {
          error: "Too many verification attempts. Please try again later.",
          rateLimitInfo: rateLimitInfo
            ? {
                remaining: rateLimitInfo.remaining || 0,
                resetTime: rateLimitInfo.resetTime || 0,
              }
            : { remaining: 0, resetTime: 0 },
          rateLimited: true,
          success: false,
        };
      }

      return { error: String(err), success: false };
    }

    const ok = data?.success === true;
    if (!ok) {
      const err = data?.message || data?.error || "Invalid OTP code";
      return { error: String(err), success: false };
    }

    return { success: true };
  } catch (error) {
    console.error("OTP verification error:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to verify OTP",
      success: false,
    };
  }
}

export async function sendVerificationLink(email: string): Promise<{
  success: boolean;
  error?: string;
  rateLimited?: boolean;
  rateLimitInfo?: {
    remaining: number;
    resetTime: number;
  };
}> {
  try {
    const authBase = env.NEXT_PUBLIC_AUTH_URL;
    const res = await fetch(`${authBase}/api/trpc/pendingSignupSendLink`, {
      body: JSON.stringify({ id: 1, json: { email } }),
      credentials: "include",
      headers: authInternalHeaders({ "content-type": "application/json" }),
      method: "POST",
    });
    const data = await res.json().catch(() => ({}) as unknown);
    const ok =
      data?.result?.data?.json?.success === true || data?.success === true;
    if (!ok) {
      const err =
        data?.result?.error?.message ||
        data?.result?.data?.json?.error ||
        data?.error ||
        "Failed to send verification link";

      if (String(err) === RATE_LIMIT_ERROR) {
        return handleRateLimitError(
          data,
          "Hold your horses! You've been clicking that button like it owes you money. Wait a moment before trying again."
        );
      }

      return { error: String(err), success: false };
    }
    return { success: true };
  } catch (error) {
    console.error("Send verification link error:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to send link",
      success: false,
    };
  }
}
