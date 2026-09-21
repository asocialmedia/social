import { getClientIpFromHeaders } from "@asm/db";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  INSTALL_TOKEN_HEADER,
  resolveInstallTokenSecret,
  verifyInstallToken,
} from "@/lib/mobile/install-token";
import { guardApiRequest } from "@/lib/security/api-security";

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

const ALLOWED_PRODUCTION_HOSTS = new Set([
  "asocialmedia.cc",
  "www.asocialmedia.cc",
]);

// When enabled, production rejects requests that did not traverse Cloudflare
// (no cf-connecting-ip header). All legitimate traffic arrives through
// Cloudflare, so this closes the direct-to-origin bypass; enable it once the
// host firewall also restricts 80/443 to Cloudflare IP ranges (see
// docker/cloudflare-origin-lockdown.md). Off by default so container health
// checks and internal calls keep working.
const ENFORCE_CLOUDFLARE = process.env.ENFORCE_CLOUDFLARE === "1";

// ── Same-origin enforcement for the API surface ────────────────────────────
// The API exists to serve this app's own frontend. Requests that arrive
// without any same-origin evidence - curl scripts, other websites, headless
// scrapers - are rejected here at the edge, before any route handler or the
// proxied auth service sees them. Set DISABLE_SAME_ORIGIN_GUARD=1 to opt out.
const SAME_ORIGIN_GUARD_DISABLED =
  process.env.DISABLE_SAME_ORIGIN_GUARD === "1";
const API_PATH_PREFIX = "/api/";

// Paths that are legitimately reached WITHOUT same-origin context:
// - health probes come from infra, never a browser;
// - OAuth providers redirect the browser straight back to the callback (a
//   cross-site top-level navigation with no Origin header); their security is
//   the provider's own state/CSRF validation;
// - better-auth's error page and emailed verification links behave the same
//   way (top-level navigation from an external referrer).
const SAME_ORIGIN_EXEMPT_PATHS = [
  "/api/health",
  "/api/auth/callback/",
  "/api/auth/error",
  "/api/auth/verify-email",
];

// Public media and avatar streaming endpoints that search engines, social bots,
// and external link previews must be able to fetch via GET/HEAD without 403s.
const PUBLIC_MEDIA_READ_PREFIXES = [
  "/api/media/",
  "/api/users/avatar/",
  "/api/users/banner/",
  "/api/communities/avatar/",
  "/api/communities/banner/",
  "/api/link-preview/image",
];

function isSameOriginExemptRequest(pathname: string, method: string): boolean {
  const isStaticExempt = SAME_ORIGIN_EXEMPT_PATHS.some(
    (exempt) =>
      pathname === exempt ||
      pathname.startsWith(`${exempt}/`) ||
      (exempt.endsWith("/") && pathname.startsWith(exempt))
  );
  if (isStaticExempt) {
    return true;
  }

  if (method === "GET" || method === "HEAD") {
    return PUBLIC_MEDIA_READ_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix)
    );
  }

  return false;
}

// Methods that cannot change state. Read-only requests stay reachable without
// a credential because the API serves public content (feeds, media, profiles).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Reachable by a no-origin client with no install token yet, or by design:
// the bootstrap itself, infrastructure probes, flows a browser reaches by
// top-level navigation (OAuth callbacks, emailed links), and the signup
// bootstrap. Signup carries its own Turnstile challenge and the OTP routes the
// auth service's per-email/per-IP budgets, so demanding an install token too
// would only force a new user through two challenges to create one account.
const INSTALL_TOKEN_EXEMPT_PATHS = [
  "/api/mobile/register",
  "/api/health",
  "/api/signup",
  "/api/verify-email",
  "/api/auth/callback/",
  "/api/auth/error",
  "/api/auth/verify-email",
];

function isInstallTokenExemptPath(pathname: string): boolean {
  return INSTALL_TOKEN_EXEMPT_PATHS.some(
    (exempt) =>
      pathname === exempt ||
      pathname.startsWith(`${exempt}/`) ||
      (exempt.endsWith("/") && pathname.startsWith(exempt))
  );
}

// True when the request carries no browser origin metadata at all. A browser
// always sends at least one of these (they are browser-controlled and cannot
// be suppressed), so this identifies non-browser callers: the native app, CLI
// tools, server-to-server jobs.
function hasNoOriginMetadata(request: NextRequest): boolean {
  return (
    !request.headers.get("origin") &&
    !request.headers.get("referer") &&
    !request.headers.get("sec-fetch-site")
  );
}

function hostOfUrlString(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return getHostname(new URL(value).host);
  } catch {
    return null;
  }
}

// A browser cannot issue a cross-origin request without origin metadata: the
// Origin header, the Referer fallback and the Sec-Fetch-Site tag are all
// browser-controlled and always populated for scripted cross-site requests.
// So *cross-site evidence* - not the absence of same-origin evidence - is the
// genuine CSRF signal.
//
// The gate previously demanded positive same-origin proof, which also rejected
// every caller that legitimately sends none: the native app (React Native's
// fetch sends no Origin, Referer or Sec-Fetch-Site), CLI tools and
// server-to-server calls. That silently 403'd the entire mobile client in
// production. Those callers are governed by the per-IP rate limits below
// instead, which is the right control for scripted traffic.
function isCrossSiteRequest(request: NextRequest): boolean {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const targetHost = getHostname(
    forwardedHost || request.headers.get("host") || ""
  );
  if (!targetHost) {
    return false;
  }

  const originHost = hostOfUrlString(request.headers.get("origin"));
  if (originHost && originHost !== targetHost) {
    return true;
  }

  const refererHost = hostOfUrlString(request.headers.get("referer"));
  if (refererHost && refererHost !== targetHost) {
    return true;
  }

  return request.headers.get("sec-fetch-site") === "cross-site";
}

export function getHostname(host: string): string {
  if (host.startsWith("[")) {
    const endBracket = host.indexOf("]");
    return endBracket === -1 ? host : host.slice(0, endBracket + 1);
  }
  return host.split(":")[0]?.toLowerCase() ?? "";
}

// Well-formed IPv4 or IPv6 address, used to reject trivial cf-connecting-ip
// spoofs (junk strings) in the Cloudflare gate. A forged valid IP is still
// possible at the middleware layer; blocking those requires the origin
// firewall that restricts 80/443 to Cloudflare ranges.
const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]{3,45}$/;
const looksLikeIp = (value: string): boolean =>
  IPV4_PATTERN.test(value) || IPV6_PATTERN.test(value);

// Resolves the client IP using the trusted-ingress policy shared with the
// rate limiter: in production only Cloudflare-provided headers are honored.
export function clientIpFromRequest(request: NextRequest): string {
  return getClientIpFromHeaders(request.headers);
}

function securityHeaders(): Record<string, string> {
  // Narrow, zero-breakage CSP: frame-ancestors kills clickjacking,
  // object-src kills plugin content, base-uri/form-action lock down form and
  // injection surfaces. Script/style sources stay unconstrained because a
  // nonce-based policy requires per-render nonces across the whole app.
  const headers: Record<string, string> = {
    "content-security-policy":
      "base-uri 'self'; frame-ancestors 'self'; object-src 'none'; form-action 'self'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
  };
  if (process.env.NODE_ENV === "production") {
    headers["strict-transport-security"] =
      "max-age=63072000; includeSubDomains";
  }
  return headers;
}

function withSecurityHeaders(response: NextResponse | Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const hostname = getHostname(host);
  const isLoopback = LOOPBACK_HOSTNAMES.has(hostname);
  const isAllowedHost = ALLOWED_PRODUCTION_HOSTS.has(hostname);

  // Canonicalize www → apex in production so every indexed URL is the apex
  // and external links on either host resolve. Cloudflare should also have a
  // page rule for this, but the app-level redirect keeps it correct even when
  // traffic reaches the origin directly. Never touch loopback fetches.
  if (
    process.env.NODE_ENV === "production" &&
    !isLoopback &&
    hostname === "www.asocialmedia.cc"
  ) {
    const url = request.nextUrl.clone();
    url.host = "asocialmedia.cc";
    url.protocol = "https:";
    return withSecurityHeaders(NextResponse.redirect(url, 301));
  }

  // Only redirect plain HTTP forwarded requests on approved production domains.
  // Never redirect internal server-to-server or loopback image optimizer fetches.
  if (
    process.env.NODE_ENV === "production" &&
    !isLoopback &&
    isAllowedHost &&
    request.headers.get("x-forwarded-proto") === "http"
  ) {
    return withSecurityHeaders(
      NextResponse.redirect(
        `https://${host}${request.nextUrl.pathname}${request.nextUrl.search}`,
        301
      )
    );
  }

  // Direct-to-origin requests bypass Cloudflare's WAF and rate limiting.
  // Reject them in production when the lockdown flag is set. Only requests
  // that carry a well-formed cf-connecting-ip (set by Cloudflare for every
  // request it forwards) are accepted; a direct caller can forge the header,
  // but the real enforcement is the host firewall that limits 80/443 to
  // Cloudflare ranges, and the header check here stays a cheap backstop.
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  const hasValidCfIp = Boolean(
    cfConnectingIp && looksLikeIp(cfConnectingIp.trim())
  );
  if (
    ENFORCE_CLOUDFLARE &&
    process.env.NODE_ENV === "production" &&
    !isLoopback &&
    !hasValidCfIp
  ) {
    return withSecurityHeaders(new NextResponse("Forbidden", { status: 403 }));
  }

  // Same-origin gate for the API surface: reject cross-site browser requests
  // (real CSRF) at the edge, before route handlers or the auth proxy run.
  // Requests with no origin metadata at all are not browser CSRF and fall
  // through to the install-token gate below.
  if (
    !SAME_ORIGIN_GUARD_DISABLED &&
    request.nextUrl.pathname.startsWith(API_PATH_PREFIX) &&
    !isLoopback &&
    request.method !== "OPTIONS" &&
    !isSameOriginExemptRequest(request.nextUrl.pathname, request.method) &&
    isCrossSiteRequest(request)
  ) {
    return withSecurityHeaders(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );
  }

  // Install-token gate. A no-origin client that wants to CHANGE something must
  // prove it holds a token this server issued. Without this, "no origin" would
  // mean "trusted", and any script could mutate the API - the previous guard
  // only appeared to prevent that, since setting `Origin` to the expected
  // value was enough to pass it. Read-only methods stay open so public content
  // remains fetchable, and the bootstrap endpoint stays open so a fresh
  // install can obtain its first token (it is Turnstile-gated instead).
  //
  // Fails open when no signing secret is configured, matching the rate
  // limiter's policy: a missing secret must not take the API down. Production
  // sets one, so the gate is active there.
  const installSecret = resolveInstallTokenSecret();
  if (
    !SAME_ORIGIN_GUARD_DISABLED &&
    installSecret &&
    request.nextUrl.pathname.startsWith(API_PATH_PREFIX) &&
    !isLoopback &&
    !SAFE_METHODS.has(request.method) &&
    !isInstallTokenExemptPath(request.nextUrl.pathname) &&
    hasNoOriginMetadata(request)
  ) {
    const presented = request.headers.get(INSTALL_TOKEN_HEADER);
    if (!verifyInstallToken(presented, installSecret)) {
      return withSecurityHeaders(
        NextResponse.json({ error: "install-token-required" }, { status: 403 })
      );
    }
  }

  // Per-IP tiered rate limiting for API routes. Fails open on Redis errors;
  // real users sit far below every threshold.
  const clientIp = clientIpFromRequest(request);
  const guard = await guardApiRequest(request.nextUrl.pathname, clientIp);
  if (guard.response) {
    return withSecurityHeaders(guard.response);
  }

  const response = withSecurityHeaders(NextResponse.next());
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    PUBLIC_MEDIA_READ_PREFIXES.some((prefix) =>
      request.nextUrl.pathname.startsWith(prefix)
    )
  ) {
    response.headers.set("x-robots-tag", "noindex");
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets. /api/ is deliberately INCLUDED so the
    // guard and security headers cover route handlers too.
    "/((?!_next/|favicon|fonts/|avatars/|socials/|site\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|webmanifest|json)$).*)",
  ],
};
