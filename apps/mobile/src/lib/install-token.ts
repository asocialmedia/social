// Pure install-token helpers: no React Native or Expo imports, so they are
// unit-testable on Node (same convention as ./api-base.ts).
//
// The token itself is opaque here - the app only ever forwards it. Signing and
// verification live on the server (apps/web/src/lib/mobile/install-token.ts).

/** Header the web API expects. Mirrors the server constant. */
export const INSTALL_TOKEN_HEADER = "x-asm-install";

export interface InstallCredentials {
  installId: string;
  token: string;
}

interface RegisterResponse {
  error?: string;
  installId?: string;
  token?: string;
}

/** Parses a /api/mobile/register payload, or null when it is not usable. */
export function parseRegisterResponse(
  payload: unknown
): InstallCredentials | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const { installId, token } = payload as RegisterResponse;
  if (typeof installId !== "string" || typeof token !== "string") {
    return null;
  }
  if (installId.length === 0 || token.length === 0) {
    return null;
  }
  return { installId, token };
}

/** Adds the install token to a header record when one is available. */
export function withInstallHeader(
  headers: Record<string, string>,
  token: string | null
): Record<string, string> {
  if (!token) {
    return headers;
  }
  return { ...headers, [INSTALL_TOKEN_HEADER]: token };
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export function resolveRequestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return typeof input.url === "string" ? input.url : null;
}

/** True when `url` belongs to `origin` (relative URLs are same-origin). */
export function isSameOrigin(url: string | null, origin: string): boolean {
  if (!url || !origin) {
    return false;
  }
  if (!url.startsWith("http")) {
    return true;
  }
  return url.startsWith(origin);
}

function mergeHeaders(
  init: RequestInit | undefined,
  token: string
): RequestInit {
  const headers = new Headers(init?.headers);
  // Never clobber a caller that set the header deliberately.
  if (!headers.has(INSTALL_TOKEN_HEADER)) {
    headers.set(INSTALL_TOKEN_HEADER, token);
  }
  return { ...init, headers };
}

/**
 * Builds a fetch that attaches the install token to same-origin requests only,
 * so the credential never leaks to another host (the update gate talks to
 * GitHub). Pure and injectable for testing.
 */
export function createInstallFetch(options: {
  baseFetch: FetchLike;
  origin: string;
  getToken: () => string | null;
}): FetchLike {
  return (input, init) => {
    const url = resolveRequestUrl(input);
    if (!isSameOrigin(url, options.origin)) {
      return options.baseFetch(input, init);
    }
    const token = options.getToken();
    if (!token) {
      // No token yet: send unchanged. A mutation will be rejected with
      // install-token-required, which the caller turns into a re-registration.
      return options.baseFetch(input, init);
    }
    return options.baseFetch(input, mergeHeaders(init, token));
  };
}
