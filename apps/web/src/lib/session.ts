import type { Session, User } from "@asm/auth/core";
import { headers as nextHeaders } from "next/headers";

export type SessionResponse = { session: Session; user: User } | null;

export async function getSessionFromApi(): Promise<SessionResponse> {
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

  if (!sessionData) {
    return null;
  }

  try {
    const tokenUrl = `${authBase}/api/trpc/generateToken`;
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      credentials: "include",
      cache: "no-store",
    });

    if (tokenRes.ok) {
      const tokenResult = await tokenRes.json();
      if (tokenResult.result?.data?.token) {
        const validateUrl = `${authBase}/api/trpc/validateToken`;
        await fetch(validateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({
            token: tokenResult.result.data.token,
          }),
          credentials: "include",
          cache: "no-store",
        });
      }
    }
  } catch (error) {
    console.warn("JWT setup failed:", error);
  }

  return sessionData;
}
