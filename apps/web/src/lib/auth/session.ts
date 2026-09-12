import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth/auth-internal";

export type SessionResponse = { session: Session; user: User } | null;

// Better Auth session cookies always contain "session_token=". Unauthenticated
// requests (guests, bots, static navigations) have no session cookie and can
// immediately return null without an expensive HTTP round trip to the auth service.
function hasSessionCookie(cookie: string): boolean {
  return cookie.includes("session_token=");
}

export const getSessionFromApi = cache(async (): Promise<SessionResponse> => {
  const hdrs = await nextHeaders();
  const cookie = hdrs.get("cookie") || "";

  // Fast-path: Skip network request entirely if no session cookie exists.
  if (!cookie || !hasSessionCookie(cookie)) {
    return null;
  }

  // Session revocation must take effect on the very next request. React's
  // cache() still deduplicates calls within this render, without keeping a
  // cross-request server cache that could revive a revoked session.
  await connection();
  return fetchSession(cookie);
});

async function fetchSession(cookie: string): Promise<SessionResponse> {
  const sessionUrl = `${getAuthBaseUrl()}/api/auth/get-session`;

  try {
    const sessionRes = await fetch(sessionUrl, {
      cache: "no-store",
      credentials: "include",
      headers: authInternalHeaders(cookie ? { cookie } : {}),
      method: "GET",
    });

    if (!sessionRes.ok) {
      return null;
    }

    let sessionData: SessionResponse;
    try {
      sessionData = (await sessionRes.json()) as SessionResponse;
    } catch {
      return null;
    }

    return sessionData || null;
  } catch {
    return null;
  }
}
