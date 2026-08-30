import { getClientIpFromHeaders } from "@asm/db";
import type { NextRequest } from "next/server";

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost:3001";
const INTERNAL_SECRET = process.env.BETTER_AUTH_SECRET;
const FORWARDED_HEADER_BLOCKLIST = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);

// Paths the auth service gates behind x-internal-secret because browsers must
// never reach them directly. Injecting the shared secret here would vouch for
// a browser-originated request and defeat that gate entirely (e.g. an
// anonymous visitor registering with role="admin" through /sign-up/email).
// The web app's own server-to-server callers attach the secret explicitly.
const BROWSER_BLOCKED_PATHS = ["/api/auth/sign-up/email"];

function isBrowserBlockedPath(pathname: string): boolean {
  return BROWSER_BLOCKED_PATHS.some((prefix) => pathname.startsWith(prefix));
}

function buildUpstreamHeaders(request: NextRequest) {
  const headers = new Headers();

  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (FORWARDED_HEADER_BLOCKLIST.has(lower)) {
      continue;
    }
    headers.set(key, value);
  }

  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.nextUrl.host;
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ||
    request.nextUrl.protocol.replace(":", "");
  const forwardedOrigin = `${forwardedProto}://${forwardedHost}`;

  headers.set("x-forwarded-host", forwardedHost);
  headers.set("x-forwarded-proto", forwardedProto);

  // The auth service derives per-IP rate-limit identities from forwarding
  // headers, so client-supplied values must never pass through verbatim: a
  // rotating X-Forwarded-For would reset every IP-keyed bucket (OTP brute
  // force). Replace them with ONE normalized client IP resolved by this
  // app's own trusted-ingress policy (Cloudflare's cf-connecting-ip when
  // present; "unknown" otherwise in production).
  const vouchedIp = getClientIpFromHeaders(request.headers);
  if (vouchedIp && vouchedIp !== "unknown") {
    headers.set("x-forwarded-for", vouchedIp);
  } else {
    headers.delete("x-forwarded-for");
  }
  headers.delete("cf-connecting-ip");
  headers.delete("x-real-ip");

  if (!headers.get("origin")) {
    headers.set("origin", forwardedOrigin);
  }

  if (!headers.get("referer")) {
    headers.set("referer", `${forwardedOrigin}/`);
  }

  // Authenticate this server-to-server proxied call to the auth service,
  // except for paths the auth service reserves for internal callers only.
  if (INTERNAL_SECRET && !isBrowserBlockedPath(request.nextUrl.pathname)) {
    headers.set("x-internal-secret", INTERNAL_SECRET);
  }

  return headers;
}

// Exported for unit tests; the proxy rewrites cookie domains so OAuth state
// cookies survive the round-trip to the auth subdomain.
export function rewriteCookieDomain(cookieStr: string, host: string): string {
  const parts = cookieStr.split(/;\s*/);
  return parts
    .map((attr) => {
      const [key] = attr.split("=");
      if (key.toLowerCase() === "domain") {
        const domainValue = attr.slice(key.length + 1);
        // A shared parent domain (e.g. ".asocialmedia.cc") already covers the
        // web host, so leave it untouched. Rewriting it to the web host would
        // scope the cookie to the web subdomain only, breaking OAuth callbacks
        // that return to the auth subdomain directly (state_mismatch).
        const baseDomain = domainValue.replace(/^\./, "");
        const hostLower = host.toLowerCase();
        const domainLower = baseDomain.toLowerCase();
        // Boundary-aware match so "social.asocialmedia.cc" matches
        // ".asocialmedia.cc" but not a lookalike like "notasocialmedia.cc".
        const hostIsDomain = hostLower === domainLower;
        const hostIsSubdomain = hostLower.endsWith(`.${domainLower}`);
        if (domainLower && (hostIsDomain || hostIsSubdomain)) {
          return attr;
        }
        return `Domain=${host}`;
      }
      return attr;
    })
    .join("; ");
}

async function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const target = new URL(AUTH_BASE);
  target.pathname = url.pathname;
  target.search = url.search;

  const headers = buildUpstreamHeaders(request);

  const init: RequestInit = {
    credentials: "include",
    headers,
    method: request.method,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    init.body = body;
  }

  try {
    const upstream = await fetch(target.toString(), init);
    const body = await upstream.arrayBuffer();
    const responseHeaders = new Headers();
    for (const [key, value] of upstream.headers) {
      const lower = key.toLowerCase();
      if (
        lower === "transfer-encoding" ||
        lower === "content-length" ||
        lower === "content-encoding" ||
        lower === "connection" ||
        lower === "set-cookie"
      ) {
        continue;
      }
      responseHeaders.append(key, value);
    }

    const [hostForCookie] = (
      request.headers.get("x-forwarded-host") ||
      request.nextUrl.host ||
      ""
    ).split(":");
    const getSetCookie = (
      upstream.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie?.bind(upstream.headers);
    const setCookieValues: string[] = getSetCookie ? getSetCookie() || [] : [];

    if (setCookieValues.length > 0) {
      for (const c of setCookieValues) {
        responseHeaders.append(
          "set-cookie",
          rewriteCookieDomain(c, hostForCookie)
        );
      }
    } else {
      const single = upstream.headers.get("set-cookie");
      if (single) {
        responseHeaders.append(
          "set-cookie",
          rewriteCookieDomain(single, hostForCookie)
        );
      }
    }

    const location = upstream.headers.get("location");
    if (location) {
      try {
        const locUrl = new URL(location, AUTH_BASE);
        const webOrigin = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
        const authOrigin = new URL(AUTH_BASE).origin;
        if (locUrl.origin === authOrigin) {
          const rewritten = locUrl.toString().replace(authOrigin, webOrigin);
          responseHeaders.set("location", rewritten);
        } else {
          responseHeaders.set("location", location);
        }
      } catch {
        responseHeaders.set("location", location);
      }
    }

    responseHeaders.set("cache-control", "no-store, private, max-age=0");
    responseHeaders.append("vary", "cookie");

    return new Response(body, {
      headers: responseHeaders,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch {
    console.error("Auth proxy upstream request failed", {
      method: request.method,
      target: target.toString(),
    });
    return Response.json(
      { error: "Internal server error" },
      {
        headers: { "content-type": "application/json" },
        status: 500,
      }
    );
  }
}

export function GET(request: NextRequest) {
  return proxy(request);
}

export function POST(request: NextRequest) {
  return proxy(request);
}

export function HEAD(request: NextRequest) {
  return proxy(request);
}

export function OPTIONS(request: NextRequest) {
  return proxy(request);
}
