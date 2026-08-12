import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";
import { cache } from "react";

export type SessionResponse = { session: Session; user: User } | null;

export const getSessionFromApi = cache(async (): Promise<SessionResponse> => {
  const hdrs = await nextHeaders();
  const cookie = hdrs.get("cookie") || "";

  const authBase = process.env.NEXT_PUBLIC_AUTH_URL || "https://auth.localhost";

  const sessionUrl = `${authBase}/api/auth/get-session`;
  const sessionRes = await fetch(sessionUrl, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    credentials: "include",
    cache: "no-store",
  });

  if (!sessionRes.ok) {
    return null;
  }

  let sessionData: SessionResponse;
  try {
    sessionData = (await sessionRes.json()) as SessionResponse;
  } catch {
    return null;
  }

  return sessionData || null;
});
