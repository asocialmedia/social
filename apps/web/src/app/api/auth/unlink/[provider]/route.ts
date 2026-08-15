import type { NextRequest } from "next/server";

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "https://auth.localhost";
const INTERNAL_SECRET = process.env.BETTER_AUTH_SECRET;

// Unlinks a social provider (google/reddit) from the current user's account by
// forwarding to better-auth's /unlink-account with the user's session cookie.
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

  const response = await fetch(`${AUTH_BASE}/api/auth/unlink-account`, {
    body: JSON.stringify({ providerId: provider }),
    headers,
    method: "POST",
  });

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
  };

  if (!response.ok) {
    return Response.json(
      { error: data.message || "Failed to unlink account" },
      { status: response.status }
    );
  }

  return Response.json({ success: true });
}
