import { prisma } from "@asm/db";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/session";

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost:3001";
const INTERNAL_SECRET = process.env.BETTER_AUTH_SECRET;

// Cookie domain rewrite mirrors the /api/auth proxy so state cookies set by
// the auth subdomain reach the browser under the web host and survive the OAuth
// round-trip. A shared parent domain (.asocialmedia.cc) is left untouched.
function rewriteCookieDomain(cookieStr: string, host: string): string {
  const parts = cookieStr.split(/;\s*/);
  return parts
    .map((attr) => {
      const [key] = attr.split("=");
      if (key.toLowerCase() !== "domain") {
        return attr;
      }
      const domainValue = attr.slice(key.length + 1);
      const baseDomain = domainValue.replace(/^\./, "");
      const hostLower = host.toLowerCase();
      const domainLower = baseDomain.toLowerCase();
      const hostIsDomain = hostLower === domainLower;
      const hostIsSubdomain = hostLower.endsWith(`.${domainLower}`);
      if (domainLower && (hostIsDomain || hostIsSubdomain)) {
        return attr;
      }
      return `Domain=${host}`;
    })
    .join("; ");
}

// Shared body used by GET (navigation from a settings page link) and POST
// (programmatic link). Both start better-auth's OAuth link flow with the user's
// session and redirect to the provider's authorization URL.
async function handleLink(request: NextRequest, provider: string) {
  if (provider !== "google" && provider !== "reddit") {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  }

  const settingsUrl = new URL("/settings", request.nextUrl.origin);
  const redirectToSettingsError = (error: string): Response => {
    settingsUrl.searchParams.set("account_error", error);
    return Response.redirect(settingsUrl, 303);
  };

  if (request.nextUrl.searchParams.get("confirmed") !== "1") {
    return redirectToSettingsError("link_confirmation_required");
  }

  const session = await getSessionFromApi();
  if (!session?.user) {
    return redirectToSettingsError("unauthorized");
  }

  const [user, credentialAccount] = await Promise.all([
    prisma.user.findUnique({
      select: { email: true, emailVerified: true },
      where: { id: session.user.id },
    }),
    prisma.account.findFirst({
      select: { password: true },
      where: { providerId: "credential", userId: session.user.id },
    }),
  ]);
  if (!user?.email || !user.emailVerified) {
    return redirectToSettingsError("link_requires_verified_email");
  }
  if (!credentialAccount?.password) {
    return redirectToSettingsError("link_requires_password");
  }

  const cookie = request.headers.get("cookie") || "";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  if (INTERNAL_SECRET) {
    headers.set("x-internal-secret", INTERNAL_SECRET);
  }

  const webOrigin = request.nextUrl.origin;

  const response = await fetch(`${AUTH_BASE}/api/auth/link-social`, {
    body: JSON.stringify({
      callbackURL: `${webOrigin}/settings?account_success=${provider}`,
      errorCallbackURL: `${webOrigin}/settings?account_error=provider_flow_failed`,
      provider,
    }),
    headers,
    method: "POST",
    redirect: "manual",
  });

  // better-auth responds 307 with the provider's authorization URL. Forward
  // the redirect AND any Set-Cookie headers (the signed OAuth state cookie),
  // rewriting cookie domains to the web host so the browser stores them.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      const [hostForCookie] = (
        request.headers.get("x-forwarded-host") ||
        request.nextUrl.host ||
        ""
      ).split(":");
      const setCookieValues: string[] = [];
      const getSetCookie = (
        response.headers as unknown as { getSetCookie?: () => string[] }
      ).getSetCookie?.bind(response.headers);
      if (getSetCookie) {
        setCookieValues.push(...(getSetCookie() || []));
      } else {
        const single = response.headers.get("set-cookie");
        if (single) {
          setCookieValues.push(single);
        }
      }
      const responseHeaders = new Headers({ location });
      for (const c of setCookieValues) {
        responseHeaders.append(
          "set-cookie",
          rewriteCookieDomain(c, hostForCookie)
        );
      }
      return new Response(null, { headers: responseHeaders, status: 307 });
    }
  }

  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    redirect?: boolean;
    url?: string;
  };

  if (body.redirect && body.url) {
    return new Response(null, {
      headers: { location: body.url },
      status: 307,
    });
  }

  return Response.json(
    {
      error: body.message || "Failed to start account linking",
    },
    { status: response.status || 400 }
  );
}

// The settings page navigates the browser to this route (a GET), so both
// methods must start the link flow.
export function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  return context.params.then(({ provider }) => handleLink(request, provider));
}

export function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  return context.params.then(({ provider }) => handleLink(request, provider));
}
