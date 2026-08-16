import { createHash } from "node:crypto";

import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth-internal";

export type SessionResponse = { session: Session; user: User } | null;

// Better Auth session cookies always contain "session_token=". Unauthenticated
// requests (guests, bots, static navigations) have no session cookie and can
// immediately return null without an expensive HTTP round trip to the auth service.
function hasSessionCookie(cookie: string): boolean {
  return cookie.includes("session_token=");
}

function hashCookie(cookie: string): string {
  return createHash("sha256").update(cookie).digest("hex");
}

// A single page render fans out to many API route handlers, each of which
// calls getSessionFromApi(). React's cache() dedupes within one render but not
// across parallel route handlers, so without this the burst of parallel routes
// would each hit the auth service. Memoize the lookup for 30s keyed by a
// cryptographic digest of the cookie so parallel and subsequent routes share
// round trips without storing raw tokens in memory.
const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_CACHE_MAX_ENTRIES = 500;

const sessionCache = new Map<
  string,
  { expiresAt: number; promise: Promise<SessionResponse> }
>();

export const getSessionFromApi = cache(async (): Promise<SessionResponse> => {
  const hdrs = await nextHeaders();
  const cookie = hdrs.get("cookie") || "";

  // Fast-path: Skip network request entirely if no session cookie exists.
  if (!cookie || !hasSessionCookie(cookie)) {
    return null;
  }

  const cacheKey = hashCookie(cookie);
  // The cache-TTL bookkeeping needs a real clock; await connection() so the
  // session lookup is evaluated at request time instead of being baked into
  // the prerender.
  await connection();
  const now = Date.now();

  const existing = sessionCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = fetchSession(cookie);
  sessionCache.set(cacheKey, {
    expiresAt: now + SESSION_CACHE_TTL_MS,
    promise,
  });

  // Prune expired entries first, then evict the oldest live entries until
  // the cache is within configured capacity.
  if (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) {
    for (const [key, entry] of sessionCache) {
      if (entry.expiresAt <= now) {
        sessionCache.delete(key);
      }
    }
    while (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) {
      const oldestKey = sessionCache.keys().next().value;
      if (typeof oldestKey === "string") {
        sessionCache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  return promise;
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
