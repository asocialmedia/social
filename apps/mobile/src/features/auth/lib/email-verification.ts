// Native port of the web (auth)/verify-email page logic. The emailed link
// carries either a token to check, an `error` code the auth service already
// decided, or `verified=1` once the browser finished the round trip.

// Same copy as the web page's ERROR_MESSAGES table.
export const VERIFY_EMAIL_ERROR_MESSAGES: Record<string, string> = {
  "invalid-token": "The verification link is invalid.",
  "server-error": "An error occurred. Please try again.",
  "token-expired": "The verification link has expired.",
  "verification-failed": "Email verification failed.",
};

export const VERIFY_EMAIL_FALLBACK_ERROR = "Invalid verification link";

export type VerifyEmailInitialState =
  | { kind: "error"; message: string }
  | { kind: "verified" }
  | { kind: "verify"; token: string };

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

// Mirrors the web derivation: an error code or a link with neither a token
// nor `verified` fails immediately, without a network round trip.
export function resolveVerifyEmailState(params: {
  error?: string | string[];
  token?: string | string[];
  verified?: string | string[];
}): VerifyEmailInitialState {
  const error = firstParam(params.error).trim();
  const token = firstParam(params.token).trim();
  const verified = firstParam(params.verified).trim();
  if (verified) {
    return { kind: "verified" };
  }
  if (error) {
    return {
      kind: "error",
      message:
        VERIFY_EMAIL_ERROR_MESSAGES[error] ?? VERIFY_EMAIL_FALLBACK_ERROR,
    };
  }
  if (!token) {
    return { kind: "error", message: VERIFY_EMAIL_FALLBACK_ERROR };
  }
  return { kind: "verify", token };
}

// The web route answers `{ ok: true }` for a fresh verification, a pending
// signup it just completed, or a caller who is already signed in.
export function isVerifyEmailSuccess(
  responseOk: boolean,
  body: unknown
): boolean {
  if (body && typeof body === "object" && "ok" in body) {
    return body.ok === true;
  }
  return responseOk;
}
