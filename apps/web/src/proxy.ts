import { getClientIpFromHeaders } from "@asm/db";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { guardApiRequest } from "@/lib/api-security";

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

  // Per-IP tiered rate limiting for API routes. Fails open on Redis errors;
  // real users sit far below every threshold.
  const clientIp = clientIpFromRequest(request);
  const guard = await guardApiRequest(request.nextUrl.pathname, clientIp);
  if (guard.response) {
    return withSecurityHeaders(guard.response);
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    // Everything except static assets. /api/ is deliberately INCLUDED so the
    // guard and security headers cover route handlers too.
    "/((?!_next/|favicon|fonts/|avatars/|socials/|site\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|webmanifest|json)$).*)",
  ],
};
