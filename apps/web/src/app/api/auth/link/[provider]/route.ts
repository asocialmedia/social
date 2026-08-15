import type { NextRequest } from "next/server";

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "https://auth.localhost";
const INTERNAL_SECRET = process.env.BETTER_AUTH_SECRET;

// Links a social provider (google/reddit) to the current user's account by
// starting better-auth's OAuth link flow. The user's session cookie is
// forwarded so /link-social runs as them; the returned authorization URL
// redirects the browser to the provider, whose callback completes the link.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params;
  if (provider !== "google" && provider !== "reddit") {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
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
      callbackURL: `${webOrigin}/settings`,
      errorCallbackURL: `${webOrigin}/settings?link_error=1`,
      provider,
    }),
    headers,
    method: "POST",
    redirect: "manual",
  });

  // better-auth responds 307 with the provider's authorization URL. Pass it
  // through so the browser follows the OAuth dance.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      return new Response(null, {
        headers: { location },
        status: 307,
      });
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
