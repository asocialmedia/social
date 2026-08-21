import { consumeRateLimit } from "@asm/db";

import { getWebLogger } from "./otel";

// Request-tier definitions for the edge-of-app guard running in proxy.ts.
// Thresholds are tuned generously: a human scrolling a feed fires a handful
// of requests per second at worst (each post view triggers one views ping,
// media loads are batched by the browser), so every tier sits well above
// real usage and only scripts and floods trip them. All tiers fail open when
// Redis is unavailable (see consumeRateLimit): an outage degrades protection,
// never availability.

export interface ApiTier {
  bucket: string;
  limitPerMinute: number;
}

// Media objects: feed scrolls and galleries fetch many images/videos at once.
const MEDIA_TIER: ApiTier = { bucket: "media", limitPerMinute: 600 };

// Expensive database-backed reads: full-text search and personalized feeds.
const HEAVY_READ_TIER: ApiTier = { bucket: "heavy-read", limitPerMinute: 120 };

// Uploads parse multipart bodies into memory; keep this tight per IP.
const UPLOAD_TIER: ApiTier = { bucket: "upload", limitPerMinute: 20 };

// Everything else under /api/.
const DEFAULT_TIER: ApiTier = { bucket: "api", limitPerMinute: 240 };

interface TierRule {
  pattern: RegExp;
  tier: ApiTier;
}

const TIER_RULES: TierRule[] = [
  { pattern: /^\/api\/media\//, tier: MEDIA_TIER },
  { pattern: /^\/api\/upload/, tier: UPLOAD_TIER },
  { pattern: /^\/api\/search/, tier: HEAVY_READ_TIER },
  {
    pattern: /^\/api\/posts\/(?:for-you|trending|following)/,
    tier: HEAVY_READ_TIER,
  },
];

// Paths that never count against any tier.
const EXEMPT_PATHS = [/^\/api\/health$/];

export function resolveApiTier(pathname: string): ApiTier | null {
  if (!pathname.startsWith("/api/")) {
    return null;
  }
  if (EXEMPT_PATHS.some((pattern) => pattern.test(pathname))) {
    return null;
  }
  for (const rule of TIER_RULES) {
    if (rule.pattern.test(pathname)) {
      return rule.tier;
    }
  }
  return DEFAULT_TIER;
}

export interface ApiGuardResult {
  response: Response | null;
}

function limitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many requests. Please slow down." },
    {
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, retryAfterSeconds)),
      },
      status: 429,
    }
  );
}

// Runs the per-IP tier limit for an incoming request. Returns a 429 Response
// when the caller is over budget, or null when the request may proceed.
export async function guardApiRequest(
  pathname: string,
  clientIp: string
): Promise<ApiGuardResult> {
  const tier = resolveApiTier(pathname);
  if (!tier) {
    return { response: null };
  }

  const result = await consumeRateLimit({
    bucket: tier.bucket,
    identifier: clientIp,
    limit: tier.limitPerMinute,
    windowSeconds: 60,
  });

  if (!result.allowed) {
    const logger = getWebLogger();
    const payload = { bucket: tier.bucket, path: pathname };
    if (logger) {
      logger.warn(payload);
    } else {
      console.warn("[api-guard] rate limit exceeded", payload);
    }
    return { response: limitedResponse(result.retryAfterSeconds) };
  }

  return { response: null };
}
