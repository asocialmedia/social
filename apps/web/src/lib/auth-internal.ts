import { keys } from "@root/keys";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

const IS_BROWSER = typeof window !== "undefined";

// Pure selector so the browser/server branch is unit-testable without mocking
// module state. `internalUrl` is the private swarm/docker auth address and is
// only present server-side; `publicUrl` is always reachable from the browser.
export function resolveAuthBaseUrl(
  internalUrl: string | undefined,
  publicUrl: string,
  isBrowser: boolean
): string {
  return isBrowser || !internalUrl ? publicUrl : internalUrl;
}

// Resolves the auth base URL for a server-to-server request. Server-side calls
// should target the private swarm/docker network (AUTH_INTERNAL_URL) instead of
// the public HTTPS endpoint: the public route adds a TLS + Cloudflare round-trip
// on every render, which is the dominant cost in client-side navigation. The
// public URL is always used in the browser, where an internal address would not
// resolve.
export function getAuthBaseUrl(): string {
  return resolveAuthBaseUrl(
    keys.AUTH_INTERNAL_URL,
    keys.NEXT_PUBLIC_AUTH_URL,
    IS_BROWSER
  );
}

// Pure selector for the app's canonical origin, shared by internal headers and allowlists.
export function resolveAppOrigin(): string {
  return (
    process.env.APP_URL ??
    keys.NEXT_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://asocialmedia.cc"
      : "http://localhost:3000")
  );
}

// Merges the shared Better Auth secret and trusted origin into server-to-server
// requests to the auth service. Requests without a browser Origin are rejected
// by Better Auth's CSRF check, so every server-side call must include them.
export function authInternalHeaders(
  headers: Record<string, string> = {}
): Record<string, string> {
  const secret = keys.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  const origin = resolveAppOrigin();

  const baseHeaders: Record<string, string> = {
    origin,
    referer: `${origin}/`,
  };

  if (secret) {
    baseHeaders[INTERNAL_SECRET_HEADER] = secret;
  }
  return { ...baseHeaders, ...headers };
}
