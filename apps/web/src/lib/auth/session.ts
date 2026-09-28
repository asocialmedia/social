import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth/auth-internal";

export type SessionResponse = { session: Session; user: User } | null;

// Better Auth session cookies always contain "session_token=". Native or API
// requests may also present an "Authorization: Bearer <token>" header.
export function hasSessionCookie(cookie: string): boolean {
  return cookie.includes("session_token=");
}

export function hasBearerToken(authorization: string): boolean {
  return (
    authorization.toLowerCase().startsWith("bearer ") &&
    authorization.slice(7).trim().length > 0
  );
}

export const getSessionFromApi = cache(async (): Promise<SessionResponse> => {
  const hdrs = await nextHeaders();
  const cookie = hdrs.get("cookie") || "";
  const authHeader = hdrs.get("authorization") || "";

  const hasCookie = Boolean(cookie && hasSessionCookie(cookie));
  const hasBearer = hasBearerToken(authHeader);

  // Fast-path: Skip network request entirely if no session evidence exists.
  if (!hasCookie && !hasBearer) {
    return null;
  }

  // Session revocation must take effect on the very next request. React's
  // cache() still deduplicates calls within this render, without keeping a
  // cross-request server cache that could revive a revoked session.
  await connection();
  return fetchSession({
    authorization: hasBearer ? authHeader : undefined,
    cookie: hasCookie ? cookie : undefined,
  });
});

async function fetchSession(options: {
  authorization?: string;
  cookie?: string;
}): Promise<SessionResponse> {
  const sessionUrl = `${getAuthBaseUrl()}/api/auth/get-session`;
  const forwardHeaders: Record<string, string> = {};
  if (options.cookie) {
    forwardHeaders.cookie = options.cookie;
  }
  if (options.authorization) {
    forwardHeaders.authorization = options.authorization;
  }

  try {
    const sessionRes = await fetch(sessionUrl, {
      cache: "no-store",
      credentials: "include",
      headers: authInternalHeaders(forwardHeaders),
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
