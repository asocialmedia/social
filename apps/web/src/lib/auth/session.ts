import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth/auth-internal";
import {
  hasBearerToken,
  hasSessionCookie,
} from "@/lib/auth/session-credentials";

export type SessionResponse = { session: Session; user: User } | null;

// Re-exported from the shared predicate module so callers keep one import site.
// Two definitions of "is this a session credential" would eventually disagree
// about what counts, and the proxy asks the same question without a request
// context to read headers from.
export {
  hasBearerToken,
  hasSessionCookie,
} from "@/lib/auth/session-credentials";

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
