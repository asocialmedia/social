import { cookies } from "next/headers";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  blueskyOAuthOrigin,
  createBlueskyOAuthClient,
} from "@/lib/protocols/oauth";
import { BLUESKY_OAUTH_COOKIE } from "@/lib/protocols/oauth-config";

const inputSchema = z
  .object({ handle: z.string().trim().min(1).max(253) })
  .strict();

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.emailVerified) {
    return Response.json(
      {
        error:
          "You must verify your email address before connecting an external account.",
      },
      { status: 403 }
    );
  }
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== blueskyOAuthOrigin())
  ) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json(
      { error: "Enter your Bluesky handle." },
      { status: 400 }
    );
  }
  const nonce = crypto.randomUUID();
  try {
    const client = createBlueskyOAuthClient(session.user.id, true);
    const url = await client.authorize(
      input.data.handle.replace(/^@/, "").toLowerCase(),
      {
        signal: AbortSignal.timeout(15_000),
        state: JSON.stringify({ nonce, userId: session.user.id }),
      }
    );
    const cookieJar = await cookies();
    cookieJar.set(BLUESKY_OAUTH_COOKIE, nonce, {
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: new URL(blueskyOAuthOrigin()).protocol === "https:",
    });
    return Response.json(
      { url: url.href },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return Response.json(
      {
        error:
          "Could not start Bluesky authorization. Check your handle and try again.",
      },
      { status: 400 }
    );
  }
}
