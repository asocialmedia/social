// Turns the many failure shapes of a sign-in call into copy the screens can
// show. Pure: no React Native or Expo imports, unit tested under bun.
//
// better-auth's client returns `{ data, error }` where `error` is the parsed
// JSON body of the failed response plus `status`/`statusText`. Our own edge
// guards (apps/web/src/proxy.ts, apps/auth/src/security) answer with
// `{ error: "<code>" }` and no `message`, which previously all collapsed to
// the generic fallback. The kind lets callers react (re-verify the install,
// wait out a rate limit) instead of just displaying text.

export type AuthErrorKind =
  | "credentials"
  | "forbidden"
  | "install-token"
  | "network"
  | "rate-limited"
  | "unknown";

export interface AuthErrorInfo {
  // What the server actually said (code and/or raw message). For logs only:
  // a person never needs to read "PROVIDER_NOT_FOUND".
  detail?: string;
  kind: AuthErrorKind;
  message: string;
  retryAfterSeconds?: number;
}

// Same copy as the web login form (components/auth/forms/login-form.tsx).
export const GENERIC_AUTH_ERROR = "Something went wrong, try again? Our bad!";
export const INVALID_CREDENTIALS_ERROR = "Invalid username/email or password";
// Banner copy is ONE short line: the error strip on the auth screens is a
// single row, so nothing here should run past ~45 characters.
export const NETWORK_ERROR = "Can't reach the server, check your connection.";
export const FORBIDDEN_ERROR = "Can't reach sign-in right now, try later.";
export const INSTALL_TOKEN_ERROR = "Finish the security check, then retry.";

const FORBIDDEN_CODES = new Set([
  "Forbidden",
  "internal-secret-required",
  "origin-not-allowed",
]);

// Wrong credentials AND unknown accounts share one message, like the web
// form, so the copy never confirms whether an email is registered.
const CREDENTIAL_CODES = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_USERNAME_OR_PASSWORD",
  "USER_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "INVALID_PASSWORD",
]);

export const SOCIAL_UNAVAILABLE_ERROR =
  "That sign-in option isn't available yet.";
export const SOCIAL_FAILED_ERROR = "Error connecting with social provider.";
export const PASSKEY_FAILED_ERROR = "Passkey sign-in failed, try again?";
export const PASSKEY_UNAVAILABLE_ERROR = "Passkeys aren't available here yet.";
export const CODE_MISMATCH_ERROR = "That code didn't match, try again.";

// better-auth error codes a user can actually hit, with copy a person can act
// on. Anything else (and any raw server sentence) falls back to the generic
// line and is kept in `detail` for the logs.
const SERVER_CODE_MESSAGES: Record<string, string> = {
  AUTHENTICATION_FAILED: PASSKEY_FAILED_ERROR,
  BANNED_USER: "This account has been suspended.",
  CHALLENGE_NOT_FOUND: PASSKEY_FAILED_ERROR,
  EMAIL_NOT_VERIFIED: "Verify your email first, check your inbox.",
  FAILED_TO_VERIFY_REGISTRATION: PASSKEY_FAILED_ERROR,
  ID_TOKEN_NOT_SUPPORTED: SOCIAL_FAILED_ERROR,
  INVALID_CODE: CODE_MISMATCH_ERROR,
  INVALID_OTP: CODE_MISMATCH_ERROR,
  INVALID_TOKEN: SOCIAL_FAILED_ERROR,
  INVALID_TWO_FACTOR_COOKIE: "Login expired, try again.",
  OTP_EXPIRED: "That code expired, request a new one.",
  OTP_HAS_EXPIRED: "That code expired, request a new one.",
  PASSKEY_NOT_FOUND: PASSKEY_FAILED_ERROR,
  PROVIDER_NOT_FOUND: SOCIAL_UNAVAILABLE_ERROR,
  SESSION_EXPIRED: "Session expired, log in again.",
  TOO_MANY_ATTEMPTS: "Too many attempts, give it a moment.",
  TWO_FACTOR_NOT_ENABLED: "Two-factor isn't enabled on this account.",
  UNAUTHORIZED: "Session expired, log in again.",
  USER_BANNED: "This account has been suspended.",
};

const NETWORK_MESSAGE = /network request failed|failed to fetch|aborted/i;

interface ErrorShape {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  retryAfter?: unknown;
  status?: unknown;
}

function asRecord(value: unknown): ErrorShape | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorShape)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asSeconds(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? Math.ceil(parsed)
    : undefined;
}

export function rateLimitMessage(retryAfterSeconds?: number): string {
  return retryAfterSeconds
    ? `Too many attempts, try again in ${retryAfterSeconds}s.`
    : "Too many attempts, give it a moment.";
}

export function describeAuthError(
  error: unknown,
  fallback: string = GENERIC_AUTH_ERROR
): AuthErrorInfo {
  const shape = asRecord(error);
  const message = asString(shape?.message);

  if (
    error instanceof TypeError ||
    (message && NETWORK_MESSAGE.test(message))
  ) {
    return { kind: "network", message: NETWORK_ERROR };
  }
  if (!shape) {
    return { kind: "unknown", message: fallback };
  }

  const code = asString(shape.error) ?? asString(shape.code);
  const status = typeof shape.status === "number" ? shape.status : undefined;

  if (code === "install-token-required") {
    return { kind: "install-token", message: INSTALL_TOKEN_ERROR };
  }
  if (code === "rate-limited" || status === 429) {
    const retryAfterSeconds = asSeconds(shape.retryAfter);
    return {
      kind: "rate-limited",
      message: rateLimitMessage(retryAfterSeconds),
      retryAfterSeconds,
    };
  }
  if (code && CREDENTIAL_CODES.has(code)) {
    return { kind: "credentials", message: INVALID_CREDENTIALS_ERROR };
  }
  if ((code && FORBIDDEN_CODES.has(code)) || (status === 403 && !message)) {
    return { detail: code, kind: "forbidden", message: FORBIDDEN_ERROR };
  }
  const detail = [code, message].filter(Boolean).join(": ") || undefined;
  const known = code ? SERVER_CODE_MESSAGES[code] : undefined;
  if (known) {
    return { detail, kind: "unknown", message: known };
  }
  // A raw better-auth sentence is developer-facing ("Provider not found",
  // "Invalid token"), so it is not shown; the fallback is.
  return { detail, kind: "unknown", message: fallback };
}

// Codes the web signup routes (/api/signup, /api/verify-email, /api/signup/*)
// return, with the same copy the web form shows for them.
const SIGNUP_CODE_MESSAGES: Record<string, string> = {
  "invalid-otp": "That code is wrong or expired, try again.",
  "invalid-request": "Something went wrong, try again?",
  "missing-token": "Something went wrong, try again?",
  "network-error": NETWORK_ERROR,
  "no-pending-signup": "Verification expired, start signup again.",
  "rate-limited": "Too many attempts, wait a moment.",
  "security-check-required": "Complete the security check first.",
  "user-exists": "That email or username is already taken.",
};

/**
 * Turns a signup route's `error` field into user copy. Those routes answer
 * either with a short code (mapped above) or with a full sentence written for
 * people (passed through). A code we do not know falls back.
 */
export function describeSignupError(
  error: string | null | undefined,
  fallback: string
): string {
  if (!error) {
    return fallback;
  }
  const known = SIGNUP_CODE_MESSAGES[error];
  if (known) {
    return known;
  }
  // Sentences contain spaces; codes ("user-exists", "INVALID_OTP") do not.
  return /\s/.test(error.trim()) ? error : fallback;
}

// Error codes a provider round-trip can hand back on the deep link. The first
// group mirrors the web error page (app/(auth)/login/error/page.tsx); the
// rest are better-auth's own callback codes.
const OAUTH_REDIRECT_MESSAGES: Record<string, string> = {
  access_denied: "Error connecting with social provider.",
  accountNotFound: "Account not found.",
  account_not_found: "Account not found.",
  emailExists: "This email is already registered.",
  email_doesnt_match: "That account uses a different email.",
  invalidCredentials: "Invalid email or password.",
  oauthError: "Error connecting with social provider.",
  please_restart_the_process: "That sign-in expired, try again.",
  serverError: "An unexpected error occurred.",
  signup_disabled: "Sign-ups are currently disabled.",
  state_mismatch: "That sign-in expired, try again.",
  unable_to_link_account: "Couldn't link that social account.",
  unauthorized: "Please log in to continue.",
};

/** Copy for an `?error=` code carried on an OAuth deep link, or null. */
export function describeOAuthRedirectError(
  code: string | null | undefined
): string | null {
  if (!code) {
    return null;
  }
  return (
    OAUTH_REDIRECT_MESSAGES[code] ?? "Error connecting with social provider."
  );
}

const ERROR_PARAM = /[?&]error=(?<code>[^&#]*)/;

/**
 * Pulls the `error` query value off a deep link. Works for both the release
 * scheme (`asocialmedia:///login?error=x`) and Expo Go (`exp://h:p/--/?error=x`)
 * without relying on the URL class, which rejects some custom schemes on
 * Hermes.
 */
export function extractRedirectError(
  url: string | null | undefined
): string | null {
  if (!url) {
    return null;
  }
  const code = ERROR_PARAM.exec(url)?.groups?.code;
  if (!code) {
    return null;
  }
  try {
    return decodeURIComponent(code);
  } catch {
    return code;
  }
}
