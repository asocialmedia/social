// The two pure predicates that decide "does this request present something
// shaped like a session credential?".
//
// They live alone in their own module because two consumers need them and they
// must not drift: the route handlers (via getSessionFromApi) and the proxy's
// install-token gate (via verify-session, which has no request context to read
// headers from). One definition, so "counts as a session credential" can never
// mean two different things.
//
// Shape is not proof. A caller can write `Authorization: Bearer x` or name a
// cookie `session_token=whatever` for free; these only say the value is worth
// ASKING the auth service about, never that it is valid.

/** Better Auth session cookies always contain "session_token=". */
export function hasSessionCookie(cookie: string): boolean {
  return cookie.includes("session_token=");
}

/** Native and API clients may present an "Authorization: Bearer <token>" header. */
export function hasBearerToken(authorization: string): boolean {
  return (
    authorization.toLowerCase().startsWith("bearer ") &&
    authorization.slice(7).trim().length > 0
  );
}
