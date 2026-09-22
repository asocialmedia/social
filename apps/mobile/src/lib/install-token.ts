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

/**
 * True when `url` belongs to `origin`. Relative URLs resolve against the
 * configured origin, so they stay same-origin; absolute URLs must have exactly
 * the same `URL.origin` (a string prefix is not enough -
 * `https://asocialmedia.cc.evil.example/` starts with the origin but is
 * another host, and `//evil.example/` is protocol-relative, not relative).
 * Non-HTTP(S) URLs such as `about:blank` carry no origin to compare, so they
 * keep the historical `true`. Unparseable input is never same-origin.
 */
export function isSameOrigin(url: string | null, origin: string): boolean {
  if (!url || !origin) {
    return false;
  }
  // Only absolute HTTP(S) URLs and protocol-relative URLs (`//host/path`,
  // which inherit the caller's scheme) have an origin worth comparing.
  if (!/^https?:\/\//i.test(url) && !url.startsWith("//")) {
    return true;
  }
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Merges a Request's own headers with per-call init headers (init wins on
 * conflict, matching `fetch(request, init)`), so neither set is dropped.
 */
function mergeRequestHeaders(input: Request, init?: RequestInit): Headers {
  const merged = new Headers(input.headers);
  if (init?.headers) {
    for (const [name, value] of new Headers(init.headers)) {
      merged.set(name, value);
    }
  }
  return merged;
}

/**
 * Returns a copy of `headers` with the install token added, or the same object
 * when it already carries one (a caller that set it deliberately wins).
 */
export function withTokenHeader(headers: Headers, token: string): Headers {
  if (headers.has(INSTALL_TOKEN_HEADER)) {
    return headers;
  }
  const next = new Headers(headers);
  next.set(INSTALL_TOKEN_HEADER, token);
  return next;
}

/**
 * Builds a fetch that attaches the install token to same-origin requests only,
 * so the credential never leaks to another host (the update gate talks to
 * GitHub). Pure and injectable for testing.
 *
 * The two input shapes are handled separately and deliberately. When `input` is
 * a Request its headers live ON the Request, and passing `{ headers }` as init
 * REPLACES them - which silently dropped `content-type` and the session
 * `cookie` that better-auth sets, breaking every call it made. So the token is
 * merged into the Request's own headers and a new Request is forwarded,
 * carrying the caller's init (signal, per-call headers) with it. Only
 * when the caller uses the url + init form do we build the headers from init.
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

    if (input instanceof Request) {
      // Forward the caller's init (signal, method/body overrides, per-call
      // headers) instead of dropping it, with the token merged into the
      // combined headers. An explicit token in either place still wins.
      return options.baseFetch(
        new Request(input, {
          ...init,
          headers: withTokenHeader(mergeRequestHeaders(input, init), token),
        })
      );
    }
    return options.baseFetch(input, {
      ...init,
      headers: withTokenHeader(new Headers(init?.headers), token),
    });
  };
}
