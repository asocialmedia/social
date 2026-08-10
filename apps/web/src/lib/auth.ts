import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const WEB_AUTH_BASE = process.env.NEXT_PUBLIC_URL || "https://social.localhost";

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(
  {
    baseURL: WEB_AUTH_BASE,
    fetchOptions: {
      credentials: "include",
    },
    plugins: [usernameClient()],
  }
);

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
