import { consumeRateLimit } from "@asm/db";

import { getWebLogger } from "../otel";

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

// Profile-image reads: the avatar and banner *object* routes for users and
// communities, plus scraped link-preview images. Matched as one family because
// they all behave the same way at the edge.
//
// The identifier segment and the trailing `/image` are both required. The
// sibling metadata routes (`/api/users/avatar/{userId}`) answer JSON and must
// not pick up an image body on throttle, nor the looser media budget; anchoring
// the tail on `/image` keeps those two apart.
const PROFILE_IMAGE_PATTERN =
  /^\/api\/(?:(?:users|communities)\/(?:avatar|banner)\/[^/]+\/image|link-preview\/image)\/?$/;

const TIER_RULES: TierRule[] = [
  { pattern: /^\/api\/media\//, tier: MEDIA_TIER },
  // Profile images are fetched in the same bursts as feed media: a single
  // profile or feed view pulls an avatar per visible author. They were falling
  // through to DEFAULT_TIER, so a page of avatars ate the same 240/min budget
  // as every other uncategorised /api/ route and tripped the guard on itself.
  { pattern: PROFILE_IMAGE_PATTERN, tier: MEDIA_TIER },
  { pattern: /^\/api\/upload/, tier: UPLOAD_TIER },
  { pattern: /^\/api\/search/, tier: HEAVY_READ_TIER },
  {
    pattern: /^\/api\/posts\/(?:for-you|latest|trending|following)/,
    tier: HEAVY_READ_TIER,
  },
  { pattern: /^\/api\/gusts/, tier: HEAVY_READ_TIER },
];

// Paths that never count against any tier.
//
// The auth proxy is exempt: every authenticated render calls get-session, the
// session-events stream is long-lived, and the auth service already applies its
// own layered per-IP limits (burst, strict, session-aware) before any route
// runs. Counting these here too meant a burst of get-session calls ate the
// shared per-IP "api" bucket, so unrelated routes from the same IP (for
// example POST /api/push/device) started returning 429. Health probes are
// infrastructure chatter.
const EXEMPT_PATHS = [/^\/api\/health$/, /^\/api\/auth\//];

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

function limitedResponse(
  pathname: string,
  retryAfterSeconds: number
): Response {
  const retryAfter = String(Math.max(1, retryAfterSeconds));
  // Never let a throttle response be cached: the real avatar bytes are served
  // with a one-year max-age, so a stored 429 would outlive the window that
  // caused it and keep serving a broken image long after the limit reset.
  const sharedHeaders = {
    "cache-control": "no-store",
    "retry-after": retryAfter,
  };

  // A JSON error document on an image URL makes every consumer report
  // "Unsupported image type", which reads as a decode bug rather than a
  // throttle. Binary endpoints get an empty 429 instead.
  if (
    PROFILE_IMAGE_PATTERN.test(pathname) ||
    pathname.startsWith("/api/media/")
  ) {
    return new Response(null, { headers: sharedHeaders, status: 429 });
  }

  return Response.json(
    { error: "Too many requests. Please slow down." },
    {
      headers: { ...sharedHeaders, "content-type": "application/json" },
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
    return { response: limitedResponse(pathname, result.retryAfterSeconds) };
  }

  return { response: null };
}
