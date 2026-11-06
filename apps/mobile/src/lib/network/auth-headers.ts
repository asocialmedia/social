// Builds request headers carrying session credentials for native API calls.
// Attaches both Cookie and Authorization: Bearer <token> so endpoints and proxies
// that inspect either transport receive the authenticated session.

export function extractSessionToken(
  cookie?: string | null | undefined
): string | null {
  if (!cookie) {
    return null;
  }
  const match = cookie.match(
    /(?:^|;\s*)(?:__Secure-)?(?:better-auth\.)?session_token=(?<token>[^;]+)/
  );
  const token = match?.groups?.token?.trim();
  return token && token.length > 0 ? token : null;
}

export function withAuthHeaders(
  headers: Record<string, string>,
  cookie?: string | null | undefined
): Record<string, string> {
  const result: Record<string, string> = { ...headers };
  if (cookie) {
    result.cookie = cookie;
    const token = extractSessionToken(cookie);
    if (token && !result.authorization) {
      result.authorization = `Bearer ${token}`;
    }
  }
  return result;
}
