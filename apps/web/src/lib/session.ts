import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";
import { cache } from "react";

import { authInternalHeaders } from "@/lib/auth-internal";

export type SessionResponse = { session: Session; user: User } | null;

// A single page render fans out to many API route handlers, each of which
// calls getSessionFromApi(). React's cache() dedupes within one render but not
// across parallel route handlers, so without this the burst of parallel routes
// would each hit the auth service. Memoize the lookup for a short window
// keyed by the request cookie so the whole burst shares ONE round trip.
const SESSION_CACHE_TTL_MS = 2000;
const SESSION_CACHE_MAX_ENTRIES = 50;

const sessionCache = new Map<
  string,
  { expiresAt: number; promise: Promise<SessionResponse> }
>();

export const getSessionFromApi = cache(async (): Promise<SessionResponse> => {
  const hdrs = await nextHeaders();
  const cookie = hdrs.get("cookie") || "";
  const now = Date.now();

  const existing = sessionCache.get(cookie);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = fetchSession(cookie);
  sessionCache.set(cookie, { expiresAt: now + SESSION_CACHE_TTL_MS, promise });

  // Opportunistically prune expired entries so the map cannot grow unbounded.
  if (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) {
    for (const [key, entry] of sessionCache) {
      if (entry.expiresAt <= Date.now()) {
        sessionCache.delete(key);
      }
    }
  }

  return promise;
});

async function fetchSession(cookie: string): Promise<SessionResponse> {
  const authBase = process.env.NEXT_PUBLIC_AUTH_URL || "https://auth.localhost";
  const sessionUrl = `${authBase}/api/auth/get-session`;

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
