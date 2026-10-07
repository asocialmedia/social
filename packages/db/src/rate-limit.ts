import { createHmac, randomUUID } from "node:crypto";

import { createLogger } from "@asm/logger";

import { keys } from "../keys";
import { redis } from "./redis";

const logger = createLogger({ serviceName: "db-rate-limit" });

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  // Logical bucket, e.g. "api", "search", "upload". Combined with the
  // identifier into the Redis key.
  bucket: string;
  // Unique caller identity (hashed ip, user id, ...).
  identifier: string;
  // Maximum hits inside the window.
  limit: number;
  // Window length in seconds.
  windowSeconds: number;
}

// Fixed-window counter in Redis. Deliberately FAIL-OPEN: if Redis is
// unavailable the request is allowed and the failure is logged. A rate
// limiter outage must never take the product down for real users; Cloudflare
// sits in front as the volumetric backstop anyway.
//
// Fixed windows are the right shape for the long, rare buckets (a den created
// once an hour): at a 3600s window the worst case is 2x the budget across one
// boundary, which for a ten-per-hour budget is twenty creates and is not what
// anyone is defending against. They are the WRONG shape for a short bucket,
// because the same property hands an attacker exactly the 2x burst at the
// boundary - see `consumeRateLimitSliding`.
export async function consumeRateLimit(
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const { bucket, identifier, limit, windowSeconds } = options;
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `ratelimit:${bucket}:${identifier}:${window}`;
  const resetAt = (window + 1) * windowSeconds * 1000;

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds + 1);
    const results = await pipeline.exec();
    const count = Number(results?.[0]?.[1] ?? 0);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  } catch (error) {
    logger.error(
      { bucket, error },
      "rate-limit redis unavailable, failing open"
    );
    return {
      allowed: true,
      remaining: limit,
      resetAt,
      retryAfterSeconds: 0,
    };
  }
}

// A true sliding window: one sorted-set member per accepted hit, and a hit only
// counts until `windowSeconds` after it happened.
//
// The fixed window above lets a caller spend its whole budget at the end of one
// window and the whole budget again at the start of the next, so the real peak
// is 2x the stated limit and the peak is exactly where an attacker aims. On a
// short bucket that is the whole attack: 30 typing heartbeats at 9.9s and 30
// more at 10.1s is 60 in 200ms against a stated budget of 30. A sliding window
// has no boundary to aim at, which is why OWASP's anti-automation guidance
// recommends token-bucket or sliding-window and warns specifically against
// fixed-window counters.
//
// Exact rather than sampled. The usual cheap alternative keeps two adjacent
// fixed windows and weights the older one linearly; that halves the key count
// but still under-counts a burst at a boundary by up to half, so it trades the
// property this exists for against Redis memory. Memory is not the constraint
// here: a bucket holds at most `limit` members, each a millisecond timestamp,
// and the sets are trimmed and expired on every call.
//
// One Lua script, because the read-count-add sequence has to be atomic. Three
// round trips would let N concurrent requests all observe `count < limit` and
// all be admitted, which on the send path is N times the work the budget was
// supposed to bound. Redis executes a script atomically, so the check and the
// write cannot interleave.
//
// A refused hit is NOT recorded. The bucket therefore drains purely as accepted
// hits age out, so a client hammering a closed bucket does not push its own
// lockout out - the first slot frees exactly `windowSeconds` after the last
// ACCEPTED hit, no matter how many times it retried in between.
//
// Fails open exactly like `consumeRateLimit`, for the same reason.
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]

-- Drop everything that has aged out of the window.
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - windowMs)
local count = tonumber(redis.call("ZCARD", key))

if count < limit then
  redis.call("ZADD", key, now, member)
  redis.call("PEXPIRE", key, windowMs + 1000)
  return {1, limit - count - 1, now + windowMs}
end

-- Over budget. The oldest member is the one whose slot frees up first, so its
-- score plus the window is the honest retry-after.
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local retryAt = now + windowMs
if oldest[2] then
  retryAt = tonumber(oldest[2]) + windowMs
end
redis.call("PEXPIRE", key, windowMs + 1000)
return {0, 0, retryAt}
`;

// Sliding-window sibling of `consumeRateLimit`, returning the same
// `RateLimitResult` so a caller can pick a window shape per rule without
// handling two different result types.
export async function consumeRateLimitSliding(
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const { bucket, identifier, limit, windowSeconds } = options;
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const resetAt = now + windowMs;
  // The member must be unique or two hits in the same millisecond collapse into
  // one ZADD entry and the window under-counts itself. A UUID makes that
  // collision-free without adding a second round trip for a counter.
  const member = `${now}-${randomUUID()}`;

  try {
    const raw = (await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      `ratelimit:${bucket}:${identifier}:sliding`,
      limit,
      windowMs,
      now,
      member
    )) as unknown;

    const parts = Array.isArray(raw) ? raw : [1, limit, resetAt];
    const allowed = Number(parts[0]) === 1;
    const remaining = Math.max(0, Number(parts[1] ?? 0));
    const retryAt = Number(parts[2] ?? resetAt);

    return {
      allowed,
      remaining,
      resetAt: retryAt,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)),
    };
  } catch (error) {
    logger.error(
      { bucket, error },
      "sliding rate-limit redis unavailable, failing open"
    );
    return {
      allowed: true,
      remaining: limit,
      resetAt,
      retryAfterSeconds: 0,
    };
  }
}

// Stable, non-reversible viewer identity for anonymous dedupe. An HMAC keyed
// by the deployment secret so raw addresses never sit in Redis keys or logs
// and the pseudonym is not derivable offline (an unkeyed SHA-256 over a small
// IP space is brute-forceable). Key rotation: set a new VIEWER_HASH_SECRET and
// old pseudonyms stop being generated; existing dedup keys expire within their
// TTL window, so a viewer may be counted once more per post after a rotation.
//
// The key chain matters: t3-env skips validation in production, so a missing
// VIEWER_HASH_SECRET arrives as undefined and the zod .default() never fires.
// Falling back to BETTER_AUTH_SECRET keeps the HMAC keyed by a real secret in
// every deployment instead of crashing createHmac at request time. The final
// fallback is the one deployment mistake this file cannot fix silently: an
// unkeyed hash is offline-recoverable over a small IP space, so running with
// it defeats the pseudonym's whole purpose. That state is made LOUD - one
// error per process, at first use - rather than fatal, because a dead
// deployment leaks nothing and helps nobody; the operator who sees this in
// their logs sets a real VIEWER_HASH_SECRET and restarts.
let warnedUnkeyed = false;
function viewerHashKey(): string {
  const key = keys.VIEWER_HASH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? null;
  if (key === null) {
    if (!warnedUnkeyed) {
      warnedUnkeyed = true;
      console.error(
        "VIEWER_HASH_SECRET and BETTER_AUTH_SECRET are both unset; " +
          "anonymous viewer pseudonyms are being derived with a fixed public " +
          "key, which is offline-recoverable over a small IP space. Set " +
          "VIEWER_HASH_SECRET to key the HMAC properly."
      );
    }
    return "asm-viewer-hash-unkeyed";
  }
  return key;
}

export function hashViewerId(ip: string): string {
  return createHmac("sha256", viewerHashKey())
    .update(ip)
    .digest("hex")
    .slice(0, 24);
}

// Resolves the client IP from a headers object (Request, NextRequest, or the
// next/headers store). In production Cloudflare is the only ingress and always
// sets cf-connecting-ip, overwriting anything the client sent, so it is the
// single trusted source. The x-forwarded-for / x-real-ip fallbacks are only
// honored outside production (local dev, tests, direct non-CF deployments)
// where a direct client can forge them.
export function getClientIpFromHeaders(headers: Pick<Headers, "get">): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) {
    return cf.trim();
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function getClientIpFromRequest(request: Request): string {
  return getClientIpFromHeaders(request.headers);
}

// Strict variant for security decisions that must NOT be rotatable by the
// client (per-viewer dedupe keys, abuse budgets): ONLY an infra-set header
// qualifies. x-forwarded-for / x-real-ip are never consulted because a direct
// client fully controls them; when no trusted ingress header exists every
// anonymous viewer collapses into one "unknown" identity, which fails closed
// against inflation instead of failing open.
export function getTrustedIngressIp(headers: Pick<Headers, "get">): string {
  const cf = headers.get("cf-connecting-ip");
  return cf?.trim() ? cf.trim() : "unknown";
}
