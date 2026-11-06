import { hasLinkedProvider } from "@asm/auth/validation";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { getApiBaseUrl, getAuthBaseUrl } from "@/lib/network/api-env";

import { authClient, persistBrowserSessionCookie } from "./auth-client";
import { authorizationProxyUrl, runBrowserOAuth } from "./browser-oauth";

export function linkProvider(
  provider: "google" | "reddit",
  userId: string,
  refresh: () => Promise<unknown>
) {
  const callback = new URL(
    Linking.createURL("/settings", { scheme: "asocialmedia" })
  );
  callback.searchParams.set("tab", "account");
  callback.searchParams.set("link_provider", provider);
  callback.searchParams.set("link_user", userId);
  const callbackUrl = callback.toString();
  return runBrowserOAuth({
    callbackUrl,
    open: async (url) =>
      WebBrowser.openAuthSessionAsync(
        authorizationProxyUrl(
          getAuthBaseUrl(),
          url,
          await authClient.getCookie()
        ),
        callbackUrl
      ),
    persist: persistBrowserSessionCookie,
    refresh: async () => {
      await refresh();
      const session = await authClient.getSession();
      if (session.error || session.data?.user.id !== userId) {
        return false;
      }
      const accounts = await authClient.listAccounts();
      return !accounts.error && hasLinkedProvider(accounts.data, provider);
    },
    request: async () => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/auth/link/${provider}?confirmed=1`,
        {
          body: JSON.stringify({ callbackURL: callbackUrl }),
          credentials: "omit",
          headers: {
            "content-type": "application/json",
            cookie: await authClient.getCookie(),
          },
          method: "POST",
          signal: AbortSignal.timeout(20_000),
        }
      );
      const data: unknown = await response.json();
      if (
        !response.ok ||
        !data ||
        typeof data !== "object" ||
        !("url" in data) ||
        typeof data.url !== "string"
      ) {
        return { error: data };
      }
      const cookie = response.headers.get("set-cookie");
      if (cookie) {
        await persistBrowserSessionCookie(cookie);
      }
      return { url: data.url };
    },
    // Linking retains the existing session; the callback need not mint a new cookie.
    requireCookie: false,
  });
}
