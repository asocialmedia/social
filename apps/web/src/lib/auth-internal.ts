import { keys } from "@root/keys";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

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
