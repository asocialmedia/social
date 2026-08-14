import type { NextRequest } from "next/server";

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "https://auth.localhost";
const INTERNAL_SECRET = process.env.BETTER_AUTH_SECRET;
const FORWARDED_HEADER_BLOCKLIST = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);

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

  if (!headers.get("origin")) {
    headers.set("origin", forwardedOrigin);
  }

  if (!headers.get("referer")) {
    headers.set("referer", `${forwardedOrigin}/`);
  }

  // Authenticate this server-to-server proxied call to the auth service.
  if (INTERNAL_SECRET) {
    headers.set("x-internal-secret", INTERNAL_SECRET);
  }

  return headers;
}

function rewriteCookieDomain(cookieStr: string, host: string): string {
  const parts = cookieStr.split(/;\s*/);
  return parts
    .map((attr) => {
      const [key] = attr.split("=");
      if (key.toLowerCase() === "domain") {
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
