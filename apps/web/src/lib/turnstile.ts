import { keys } from "@root/keys";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 10_000;

type TurnstileFetch = (
  input: URL | RequestInfo,
  init?: RequestInit
) => Promise<Response>;

export interface SignupTurnstileConfig {
  allowedHostnames: string[];
  secret: string;
}

export type TurnstileVerificationResult =
  | { success: true }
  | {
      reason: "configuration" | "invalid-token" | "unavailable";
      success: false;
    };

interface TurnstileSiteverifyResponse {
  action?: unknown;
  hostname?: unknown;
  success?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTurnstileSiteverifyResponse(
  value: unknown
): value is TurnstileSiteverifyResponse {
  return isRecord(value);
}

function hasOnlyPublicProductionHostnames(hostnames: string[]): boolean {
  return !hostnames.some(
    (hostname) => hostname === "localhost" || hostname === "127.0.0.1"
  );
}

export function getSignupTurnstileConfig(values?: {
  allowedHostnames?: string;
  environment?: string;
  secret?: string;
}): SignupTurnstileConfig | undefined {
  // Default branch reads through the validated keys accessor so the consumed
  // names and validation rules cannot drift from apps/web/keys.ts. The
  // injectable `values` parameter keeps precedence for tests.
  const configValues = values ?? {
    allowedHostnames: keys.TURNSTILE_HOSTNAMES,
    environment: keys.NODE_ENV,
    secret: keys.TURNSTILE_SECRET,
  };
  const secret = configValues.secret?.trim();
  const allowedHostnames = (configValues.allowedHostnames ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname.length > 0);

  if (!secret || allowedHostnames.length === 0) {
    return undefined;
  }

  if (
    configValues.environment === "production" &&
    !hasOnlyPublicProductionHostnames(allowedHostnames)
  ) {
    return undefined;
  }

  return { allowedHostnames, secret };
}

// Siteverify tokens are single-use and short-lived. Require the expected
// Turnstile action and hostname as well as success so a token issued for a
// different form or host cannot create an account.
export async function verifySignupTurnstileToken(
  token: string | undefined,
  remoteIp: string | undefined,
  config: SignupTurnstileConfig | undefined = getSignupTurnstileConfig(),
  fetchSiteverify: TurnstileFetch = fetch
): Promise<TurnstileVerificationResult> {
  if (!config) {
    return { reason: "configuration", success: false };
  }
  if (!token || token.length > 4096) {
    return { reason: "invalid-token", success: false };
  }

  const form = new URLSearchParams({
    response: token,
    secret: config.secret,
  });
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }

  let response: Response;
  try {
    response = await fetchSiteverify(TURNSTILE_SITEVERIFY_URL, {
      body: form,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
  } catch {
    return { reason: "unavailable", success: false };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { reason: "unavailable", success: false };
  }
  if (!response.ok || !isTurnstileSiteverifyResponse(body)) {
    return { reason: "unavailable", success: false };
  }
  if (
    body.success !== true ||
    body.action !== "signup" ||
    typeof body.hostname !== "string" ||
    !config.allowedHostnames.includes(body.hostname.toLowerCase())
  ) {
    return { reason: "invalid-token", success: false };
  }

  return { success: true };
}
