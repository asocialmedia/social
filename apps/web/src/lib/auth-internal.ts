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

// Merges the shared Better Auth secret into server-to-server requests to the
// auth service. Requests without a browser Origin are rejected by auth unless
// they carry this header, so every server-side call to auth must include it.
export function authInternalHeaders(
  headers: Record<string, string> = {}
): Record<string, string> {
  const secret = keys.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return headers;
  }
  return { ...headers, [INTERNAL_SECRET_HEADER]: secret };
}
