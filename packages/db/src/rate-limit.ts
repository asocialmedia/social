import { createHmac } from "node:crypto";

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

// Stable, non-reversible viewer identity for anonymous dedupe. An HMAC keyed
// by the deployment secret so raw addresses never sit in Redis keys or logs
// and the pseudonym is not derivable offline (an unkeyed SHA-256 over a small
// IP space is brute-forceable). Key rotation: set a new VIEWER_HASH_SECRET and
// old pseudonyms stop being generated; existing dedup keys expire within their
// TTL window, so a viewer may be counted once more per post after a rotation.
export function hashViewerId(ip: string): string {
  return createHmac("sha256", keys.VIEWER_HASH_SECRET)
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
  if (process.env.NODE_ENV === "production") {
    return "unknown";
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
