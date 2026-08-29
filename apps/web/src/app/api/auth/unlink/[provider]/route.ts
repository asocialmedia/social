import type { NextRequest } from "next/server";

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost:3001";
const INTERNAL_SECRET = process.env.BETTER_AUTH_SECRET;

// Unlinks a social provider (google/reddit) from the current user's account by
// forwarding to better-auth's /unlink-account with the user's session cookie.
// better-auth 1.7 identifies the account by its row id (not providerId), so
// the linked accounts are listed first and the matching row's id is passed
// through.
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

  const accountsRes = await fetch(`${AUTH_BASE}/api/auth/list-accounts`, {
    headers,
    method: "GET",
  });
  if (!accountsRes.ok) {
    return Response.json(
      { error: "Failed to read linked accounts" },
      { status: accountsRes.status }
    );
  }
  const accounts = (await accountsRes.json().catch(() => [])) as {
    id: string;
    providerId: string;
  }[];
  const target = accounts.find((account) => account.providerId === provider);
  if (!target) {
    return Response.json({ error: "Account is not linked" }, { status: 404 });
  }

  const response = await fetch(`${AUTH_BASE}/api/auth/unlink-account`, {
    body: JSON.stringify({ accountId: target.id }),
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
