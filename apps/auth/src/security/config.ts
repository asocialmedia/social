import type { SecurityConfig } from "./index";

const DEFAULT_MAX_BODY_BYTES = 100 * 1024;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 512;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

// Authenticated users (valid session cookie) get a very generous limit so
// normal browsing never trips it.
const DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 600;

// Anonymous requests (no valid session) get a moderate per-IP limit.
const DEFAULT_ANON_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_ANON_RATE_LIMIT_MAX = 120;

// Sensitive auth endpoints are abuse-prone (sign-in, sign-up, OTP, password
// reset) and get a tight per-IP limit regardless of session state.
const DEFAULT_STRICT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_STRICT_RATE_LIMIT_MAX = 30;

// Continuous-polling detection: a short window that blocks scripts hammering
// the API. A real user clicking around never sends 30 requests in 5 seconds.
const DEFAULT_BURST_WINDOW_MS = 5000;
const DEFAULT_BURST_MAX = 30;

const TRAILING_SLASH_REGEX = /\/+$/;

// Paths that get tighter per-IP limits because they are abuse-prone: sign in,
// sign up, OTP verification and password reset. get-session is intentionally
// excluded because the app calls it constantly.
const DEFAULT_STRICT_PATHS = [
  /^\/api\/trpc\/pendingSignup/,
  /^\/api\/trpc\/resetPassword/,
  /^\/api\/auth\/sign-in/,
  /^\/api\/auth\/sign-up/,
  /^\/api\/auth\/email-otp/,
];

function buildAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = new Set<string>();
  const add = (value: string | undefined) => {
    if (value) {
      origins.add(value.replace(TRAILING_SLASH_REGEX, ""));
    }
  };
  add(env.APP_URL);
  add(env.AUTH_URL);
  add(env.NEXT_PUBLIC_URL);
  add(env.NEXT_PUBLIC_AUTH_URL);
  // Production origins
  add("https://asocialmedia.cc");
  add("https://auth.asocialmedia.cc");
  // Local development origins
  add("http://localhost:3000");
  add("http://localhost:3001");
  add("https://social.localhost");
  add("https://auth.localhost");
  return [...origins];
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readSecurityConfig(
  env: NodeJS.ProcessEnv = process.env
): SecurityConfig {
  return {
    allowedOrigins: buildAllowedOrigins(env),
    anonRateLimitMax: parseNumber(
      env.AUTH_ANON_RATE_LIMIT_MAX,
      DEFAULT_ANON_RATE_LIMIT_MAX
    ),
    anonRateLimitWindowMs: parseNumber(
      env.AUTH_ANON_RATE_LIMIT_WINDOW_MS,
      DEFAULT_ANON_RATE_LIMIT_WINDOW_MS
    ),
    authRateLimitMax: parseNumber(
      env.AUTH_AUTH_RATE_LIMIT_MAX,
      DEFAULT_AUTH_RATE_LIMIT_MAX
    ),
    authRateLimitWindowMs: parseNumber(
      env.AUTH_AUTH_RATE_LIMIT_WINDOW_MS,
      DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS
    ),
    burstRateLimitMax: parseNumber(
      env.AUTH_BURST_RATE_LIMIT_MAX,
      DEFAULT_BURST_MAX
    ),
    burstRateLimitWindowMs: parseNumber(
      env.AUTH_BURST_RATE_LIMIT_WINDOW_MS,
      DEFAULT_BURST_WINDOW_MS
    ),
    internalSecret: env.AUTH_INTERNAL_SECRET ?? env.BETTER_AUTH_SECRET,
    maxBodyBytes: parseNumber(env.AUTH_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    maxConcurrentRequests: parseNumber(
      env.AUTH_MAX_CONCURRENT_REQUESTS,
      DEFAULT_MAX_CONCURRENT_REQUESTS
    ),
    requestTimeoutMs: parseNumber(
      env.AUTH_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS
    ),
    strictPaths: DEFAULT_STRICT_PATHS,
    strictRateLimitMax: parseNumber(
      env.AUTH_STRICT_RATE_LIMIT_MAX,
      DEFAULT_STRICT_RATE_LIMIT_MAX
    ),
    strictRateLimitWindowMs: parseNumber(
      env.AUTH_STRICT_RATE_LIMIT_WINDOW_MS,
      DEFAULT_STRICT_RATE_LIMIT_WINDOW_MS
    ),
  };
}
