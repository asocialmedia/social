// Thin client for the auth endpoints the native app drives directly. Every
// call rides the web origin, which proxies /api/auth/* to the auth service and
// injects the internal secret server-side - the app never holds one.
import { getApiBaseUrl } from "./api-env";
import { logError } from "./telemetry";

const REQUEST_TIMEOUT_MS = 20_000;

interface JsonResult<T> {
  data: T | null;
  ok: boolean;
  status: number;
}

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<JsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

export interface ActionResult {
  error?: string;
  ok: boolean;
}

interface ResetRequestResponse {
  error?: string;
  retryAfter?: number;
  success?: boolean;
}

// Requests a password reset link. The server never reveals whether the account
// exists, so a success response only means "if it exists, we emailed it".
export async function requestPasswordReset(
  identifier: string
): Promise<ActionResult> {
  try {
    const { data, ok } = await postJson<ResetRequestResponse>(
      "/api/reset-password",
      { identifier }
    );
    if (!ok) {
      const wait = data?.retryAfter
        ? ` Please wait ${Math.ceil(data.retryAfter / 60)} minutes before trying again.`
        : "";
      return {
        error: `${data?.error ?? "Couldn't send the reset email, try again?"}${wait}`,
        ok: false,
      };
    }
    return { ok: true };
  } catch (error) {
    logError("auth.reset_request_failed", error);
    return {
      error: "Couldn't reach the server. Check your connection and try again.",
      ok: false,
    };
  }
}

// Confirms a reset token is still valid and unexpired before showing the form.
export async function validateResetToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/reset-password?token=${encodeURIComponent(token)}`
    );
    return response.ok;
  } catch (error) {
    logError("auth.reset_token_check_failed", error);
    return false;
  }
}

interface ResetConfirmResponse {
  code?: string;
  message?: string;
}

const RESET_ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN:
    "This reset link is invalid or has expired. Request a new one.",
  PASSWORD_COMPROMISED:
    "That password has appeared in a data breach. Pick a different one.",
  PASSWORD_TOO_SHORT: "That password is too short.",
};

// Applies the new password. Better Auth owns the token check and the
// compromised-password check server-side.
export async function confirmPasswordReset(
  password: string,
  token: string
): Promise<ActionResult> {
  try {
    const { data, ok } = await postJson<ResetConfirmResponse>(
      "/api/auth/reset-password",
      { newPassword: password, token }
    );
    if (!ok) {
      const mapped = data?.code ? RESET_ERROR_MESSAGES[data.code] : undefined;
      return {
        error:
          mapped ?? data?.message ?? "Couldn't reset your password, try again?",
        ok: false,
      };
    }
    return { ok: true };
  } catch (error) {
    logError("auth.reset_confirm_failed", error);
    return {
      error: "Couldn't reach the server. Check your connection and try again.",
      ok: false,
    };
  }
}
