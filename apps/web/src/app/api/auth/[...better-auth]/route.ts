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

  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (FORWARDED_HEADER_BLOCKLIST.has(lower)) {
      return;
    }
    headers.set(key, value);
  });

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

async function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const target = new URL(AUTH_BASE);
  target.pathname = url.pathname;
  target.search = url.search;

  const headers = buildUpstreamHeaders(request);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    credentials: "include",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    init.body = body;
  }

  try {
    const upstream = await fetch(target.toString(), init);
    const body = await upstream.arrayBuffer();
    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower === "transfer-encoding" ||
        lower === "content-length" ||
        lower === "content-encoding" ||
        lower === "connection" ||
        lower === "set-cookie"
      ) {
        return;
      }
      responseHeaders.append(key, value);
    });

    const [hostForCookie] = (
      request.headers.get("x-forwarded-host") ||
      request.nextUrl.host ||
      ""
    ).split(":");
    const getSetCookie = (
      upstream.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie?.bind(upstream.headers);
    const setCookieValues: string[] = getSetCookie ? getSetCookie() || [] : [];

    function rewriteCookieDomain(cookieStr: string): string {
      // biome-ignore lint/performance/useTopLevelRegex: ignore
      const parts = cookieStr.split(/;\s*/);
      let _replaced = false;
      const rewritten = parts.map((attr) => {
        const [k] = attr.split("=");
        if (k.toLowerCase() === "domain") {
          _replaced = true;
          return `Domain=${hostForCookie}`;
        }
        return attr;
      });
      return rewritten.join("; ");
    }

    if (setCookieValues.length > 0) {
      for (const c of setCookieValues) {
        responseHeaders.append("set-cookie", rewriteCookieDomain(c));
      }
    } else {
      const single = upstream.headers.get("set-cookie");
      if (single) {
        responseHeaders.append("set-cookie", rewriteCookieDomain(single));
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
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    console.error("Auth proxy upstream request failed", {
      method: request.method,
      target: target.toString(),
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
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
