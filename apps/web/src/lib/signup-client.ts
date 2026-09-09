import type { SignUpValues } from "@asm/auth/validation";

interface SignUpResult {
  emailVerification?: {
    email: string;
    isNewToken: boolean;
  };
  errorCode?: "user-exists";
  error?: string;
  rateLimited?: boolean;
  rateLimitInfo?: {
    remaining: number;
    resetTime: number;
  };
  requiresEmailVerification?: boolean;
  success: boolean;
}

function isSignUpResult(value: unknown): value is SignUpResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof value.success === "boolean"
  );
}

// Browser fetch prevents Next development tooling from printing password and
// CAPTCHA arguments, which can happen when they are passed to a Server Action.
export async function requestSignup(
  values: SignUpValues,
  turnstileToken: string
): Promise<SignUpResult> {
  try {
    const response = await fetch("/api/signup", {
      body: JSON.stringify({ ...values, turnstileToken }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json().catch(() => null);
    if (isSignUpResult(body)) {
      return body;
    }
  } catch {
    // The UI receives a stable, actionable message below. Details remain
    // server-side so neither credentials nor infrastructure errors leak.
  }

  return {
    error:
      "We couldn't reach the signup service. Check your connection and try again.",
    success: false,
  };
}
