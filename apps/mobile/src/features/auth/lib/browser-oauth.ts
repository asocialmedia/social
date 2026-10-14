import { extractRedirectError } from "./auth-errors";

export type BrowserOAuthResult =
  | { status: "cancelled" }
  | { status: "failed"; error: unknown }
  | { status: "redirect-error"; code: string }
  | { status: "missing-cookie" }
  | { status: "complete" };

export function authorizationProxyUrl(
  authBase: string,
  authorizationUrl: string,
  cookie: string
): string {
  const proxy = new URL(
    `${authBase.replace(/\/+$/, "")}/expo-authorization-proxy`
  );
  const providerUrl = new URL(authorizationUrl);
  // Reddit documents a separate authorization page for mobile browsers.
  if (
    providerUrl.hostname === "www.reddit.com" &&
    providerUrl.pathname === "/api/v1/authorize"
  ) {
    providerUrl.pathname = "/api/v1/authorize.compact";
  }
  proxy.searchParams.set("authorizationURL", providerUrl.toString());
  const state = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find(
      (entry) =>
        entry.startsWith("__Secure-better-auth.oauth_state=") ||
        entry.startsWith("better-auth.oauth_state=")
    );
  if (state) {
    proxy.searchParams.set("oauthState", state.slice(state.indexOf("=") + 1));
  }
  return proxy.toString();
}

// The authorization request must finish before the browser opens. Persist the
// returned cookie before a session refresh or navigation can race the handoff.
export async function runBrowserOAuth({
  request,
  open,
  persist,
  refresh,
  callbackUrl,
  requireCookie = true,
}: {
  request: () => Promise<{ url?: string; error?: unknown }>;
  open: (authorizationUrl: string) => Promise<{ type: string; url?: string }>;
  persist: (cookie: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  callbackUrl: string;
  requireCookie?: boolean;
}): Promise<BrowserOAuthResult> {
  const response = await request();
  if (response.error || !response.url) {
    return {
      error: response.error ?? new Error("Missing authorization URL"),
      status: "failed",
    };
  }
  const result = await open(response.url);
  if (result.type !== "success") {
    return { status: "cancelled" };
  }
  if (!result.url) {
    return { status: "missing-cookie" };
  }
  const returned = new URL(result.url);
  const expected = new URL(callbackUrl);
  if (
    returned.protocol !== expected.protocol ||
    returned.host !== expected.host ||
    returned.pathname !== expected.pathname
  ) {
    return { error: new Error("Unexpected OAuth callback"), status: "failed" };
  }
  const code = extractRedirectError(result.url);
  if (code) {
    return { code, status: "redirect-error" };
  }
  const cookie = returned.searchParams.get("cookie");
  if (!cookie && requireCookie) {
    return { status: "missing-cookie" };
  }
  if (cookie) {
    await persist(cookie);
  }
  return (await refresh())
    ? { status: "complete" }
    : { status: "missing-cookie" };
}
