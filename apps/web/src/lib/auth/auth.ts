import { passkeyClient } from "@better-auth/passkey/client";
import {
  lastLoginMethodClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const WEB_AUTH_BASE = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

function getLastLoginCookieDomain(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const { hostname } = window.location;
  return hostname === "asocialmedia.cc" || hostname.endsWith(".asocialmedia.cc")
    ? ".asocialmedia.cc"
    : undefined;
}

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined" ? WEB_AUTH_BASE : window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    usernameClient(),
    // The credential form renders the challenge inline after it receives the
    // available methods. Supplying this callback prevents the plugin from
    // navigating away before the form can take over.
    twoFactorClient({
      onTwoFactorRedirect: () => {
        /* empty */
      },
    }),
    passkeyClient(),
    lastLoginMethodClient({ domain: getLastLoginCookieDomain() }),
  ],
});

export type { Session, User } from "@asm/auth/core";

export function getAuthToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("auth_token");
  }
  return null;
}

export function authenticatedFetch(url: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
