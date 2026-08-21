import { createHash, timingSafeEqual } from "node:crypto";

const TRAILING_SLASH_REGEX = /\/+$/;

export interface SecurityConfig {
  allowedOrigins: string[];
  anonRateLimitMax: number;
  anonRateLimitWindowMs: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  burstRateLimitMax: number;
  burstRateLimitWindowMs: number;
  internalSecret: string | undefined;
  maxBodyBytes: number;
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
  strictPaths: RegExp[];
  strictRateLimitMax: number;
  strictRateLimitWindowMs: number;
}

export interface SecurityDecision {
  allowed: boolean;
  reason?: string;
  response?: Response;
}

export interface Security {
  check: (request: Request, ip: string) => Promise<SecurityDecision>;
  headers: () => Record<string, string>;
}

export interface RateLimitHit {
  hit: boolean;
  retryAfterSeconds: number;
}

// Pluggable counter backend for the layered per-IP limits. The in-memory
// implementation is the default (fast, zero-dependency); a Redis-backed
// implementation survives restarts and deploys so an attacker cannot reset
// their budget by forcing a rollout.
export interface AsyncRateLimitStore {
  hit: (
    key: string,
    windowMs: number,
    max: number,
    now: number
  ) => Promise<RateLimitHit>;
}

class InMemoryRateLimitStore implements AsyncRateLimitStore {
  private readonly entries = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private lastPrune = Date.now();

  hit(
    key: string,
    windowMs: number,
    max: number,
    now: number
  ): Promise<RateLimitHit> {
    if (now - this.lastPrune > 60_000) {
      pruneStore(this.entries, now);
      this.lastPrune = now;
    }
    return rateLimitHit(this.entries, key, windowMs, max, now);
  }
}

function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!(a && b)) {
    return false;
  }
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

function getClientOrigin(request: Request): string | undefined {
  return request.headers.get("origin") ?? undefined;
}

function hasValidSecret(request: Request, secret: string | undefined): boolean {
  if (!secret) {
    return false;
  }
  const header = request.headers.get("x-internal-secret") ?? undefined;
  return safeEqual(header, secret);
}

function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.includes("session_token=");
}

function isAllowedOrigin(
  origin: string | undefined,
  allowed: string[]
): boolean {
  if (!origin) {
    return false;
  }
  const normalized = origin.replace(TRAILING_SLASH_REGEX, "");
  return allowed.some(
    (entry) => entry.replace(TRAILING_SLASH_REGEX, "") === normalized
  );
}

// OAuth providers redirect the browser straight back to these endpoints
// (Google -> /api/auth/callback/google). Top-level navigation redirects carry
// no Origin header, so they would otherwise be rejected as server-to-server
// calls without the internal secret. These are legitimate browser callbacks:
// the provider's own state/CSRF handling protects them.
const OAUTH_CALLBACK_PREFIX = "/api/auth/callback/";

function isOAuthCallback(pathname: string): boolean {
  return pathname.startsWith(OAUTH_CALLBACK_PREFIX);
}

function isStrictPath(pathname: string, strictPaths: RegExp[]): boolean {
  return strictPaths.some((pattern) => pattern.test(pathname));
}

function buildReject(
  status: number,
  body: Record<string, unknown>,
  retryAfterSeconds?: number
): SecurityDecision {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(retryAfterSeconds);
  }
  return {
    allowed: false,
    response: Response.json(body, { headers, status }),
  };
}

function pruneStore(
  store: Map<string, { count: number; resetAt: number }>,
  now: number
): void {
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) {
      store.delete(key);
    }
  }
}

function rateLimitHit(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  windowMs: number,
  max: number,
  now: number
): { hit: boolean; retryAfterSeconds: number } {
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { hit: false, retryAfterSeconds: 0 };
  }

  if (entry.count >= max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - now) / 1000)
    );
    return { hit: true, retryAfterSeconds };
  }

  entry.count += 1;
  store.set(key, entry);
  return { hit: false, retryAfterSeconds: 0 };
}

const SECURITY_HEADERS: Record<string, string> = {
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
};

export function securityHeaders(): Record<string, string> {
  return { ...SECURITY_HEADERS };
}

// Builds the security guard that runs before any request is routed. It
// rejects requests from disallowed origins, requests without the internal
// secret when they carry no browser origin, oversized bodies, and floods from
// a single IP. All responses get hardened security headers.
//
// The rate-limit store is pluggable: the default in-memory store resets on
// every deploy, so production injects the Redis-backed store to keep attacker
// budgets across restarts.
export function createSecurity(
  config: SecurityConfig,
  store: AsyncRateLimitStore = new InMemoryRateLimitStore()
): Security {
  const headers = (): Record<string, string> => ({ ...SECURITY_HEADERS });

  // Browser cross-origin calls carry an Origin header. Server-to-server calls
  // from the web app do not, so they must present the internal secret. OAuth
  // callbacks are browser redirects (GET, no Origin) and are allowed through
  // so Google/Reddit can hand the user back to the auth service.
  const checkOriginOrSecret = (
    request: Request,
    pathname: string
  ): SecurityDecision => {
    const origin = getClientOrigin(request);
    if (origin) {
      if (!isAllowedOrigin(origin, config.allowedOrigins)) {
        return buildReject(403, { error: "origin-not-allowed" });
      }
      return { allowed: true };
    }
    if (request.method === "GET" && isOAuthCallback(pathname)) {
      return { allowed: true };
    }
    if (!hasValidSecret(request, config.internalSecret)) {
      return buildReject(403, { error: "internal-secret-required" });
    }
    return { allowed: true };
  };

  const check = async (
    request: Request,
    ip: string
  ): Promise<SecurityDecision> => {
    const now = Date.now();

    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return checkOriginOrSecret(request, pathname);
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return buildReject(405, { error: "method-not-allowed" });
    }

    if (pathname !== "/api/health") {
      const pathDecision = await checkPath(request, pathname, ip, now);
      if (!pathDecision.allowed) {
        return pathDecision;
      }
    }

    return { allowed: true };
  };

  // Runs the non-health path checks: allowlist, body size, origin or internal
  // secret, and per-IP flood limits.
  const checkPath = (
    request: Request,
    pathname: string,
    ip: string,
    now: number
  ): Promise<SecurityDecision> => {
    const allowedPath =
      pathname.startsWith("/api/auth") || pathname.startsWith("/api/trpc");
    if (!allowedPath) {
      return buildReject(404, { error: "not-found" });
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > config.maxBodyBytes) {
      return buildReject(413, { error: "payload-too-large" });
    }

    const authDecision = checkOriginOrSecret(request, pathname);
    if (!authDecision.allowed) {
      return authDecision;
    }

    return checkRateLimits(request, pathname, ip, now);
  };

  // Applies the layered per-IP limits: burst (continuous polling), strict
  // (brute-force targets), then a session-aware general limit.
  const checkRateLimits = async (
    request: Request,
    pathname: string,
    ip: string,
    now: number
  ): Promise<SecurityDecision> => {
    const burst = await store.hit(
      `burst:${ip}`,
      config.burstRateLimitWindowMs,
      config.burstRateLimitMax,
      now
    );
    if (burst.hit) {
      return rejectRateLimited(burst.retryAfterSeconds);
    }

    if (isStrictPath(pathname, config.strictPaths)) {
      const strict = await store.hit(
        `strict:${ip}:${pathname}`,
        config.strictRateLimitWindowMs,
        config.strictRateLimitMax,
        now
      );
      if (strict.hit) {
        return rejectRateLimited(strict.retryAfterSeconds);
      }
      return { allowed: true };
    }

    const authenticated = hasSessionCookie(request);
    const windowMs = authenticated
      ? config.authRateLimitWindowMs
      : config.anonRateLimitWindowMs;
    const max = authenticated
      ? config.authRateLimitMax
      : config.anonRateLimitMax;
    const limiterKey = authenticated ? `auth:${ip}` : `anon:${ip}`;

    const limit = await store.hit(limiterKey, windowMs, max, now);
    if (limit.hit) {
      return rejectRateLimited(limit.retryAfterSeconds);
    }

    return { allowed: true };
  };

  const rejectRateLimited = (retryAfterSeconds: number): SecurityDecision =>
    buildReject(
      429,
      { error: "rate-limited", retryAfter: retryAfterSeconds },
      retryAfterSeconds
    );

  return { check, headers };
}
