// Resolves a request's session credentials against the auth service.
//
// Exists because "the request carries something shaped like a credential" and
// "the request carries a valid credential" are different claims, and only the
// second one is worth anything. Any script can send `Authorization: Bearer x`;
// a cookie named `better-auth.session_token=whatever` is equally free to write.
// A gate that reads the shape is a gate that grants on presence, which is the
// same mistake as treating "no Origin" as "trusted".
//
// The check is a single call to the auth service's get-session, which is the
// same resolution every route handler performs through getSessionFromApi. It is
// deliberately NOT cached across requests: session revocation has to take effect
// on the very next request, and a short-lived cache here would silently reopen
// that window for every authenticated mutation.
//
// Failure is always "not verified". An auth service that is down, slow, or
// answering nonsense must not widen the exemption - it narrows it, and the
// caller falls back to whatever other credential it can check locally.

import { authInternalHeaders, getAuthBaseUrl } from "./auth-internal";
import { hasBearerToken, hasSessionCookie } from "./session-credentials";

export interface VerifySessionOptions {
  /** Raw Authorization header, forwarded verbatim when it is a Bearer token. */
  authorization?: string;
  /** Raw Cookie header, forwarded verbatim when it carries a session cookie. */
  cookie?: string;
  baseFetch?: typeof fetch;
  /** Bounds the call so an unresponsive auth service cannot hang the caller. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

interface SessionPayload {
  session?: unknown;
}

/**
 * True only when the auth service resolves these credentials to a live session.
 * Never throws: every failure path is a false, because a false here costs one
 * extra credential check at the caller, while a true costs a security boundary.
 */
export async function hasVerifiedSession(
  options: VerifySessionOptions
): Promise<boolean> {
  const cookie = options.cookie ?? "";
  const authorization = options.authorization ?? "";
  const hasCookie = hasSessionCookie(cookie);
  const hasBearer = hasBearerToken(authorization);
  if (!hasCookie && !hasBearer) {
    return false;
  }

  const baseFetch = options.baseFetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await baseFetch(
      `${getAuthBaseUrl()}/api/auth/get-session`,
      {
        cache: "no-store",
        credentials: "include",
        headers: authInternalHeaders({
          ...(hasCookie ? { cookie } : {}),
          ...(hasBearer ? { authorization } : {}),
        }),
        method: "GET",
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as SessionPayload | null;
    return Boolean(payload && typeof payload === "object" && payload.session);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
