import { debugLog } from "@asm/config/debug";
import type { NextRequest } from "next/server";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth-internal";

type PendingVerifyResult =
  | { ok: true; data?: { email: string; password: string } }
  | { ok: true }
  | false;

async function tryPendingSignupVerification(
  req: NextRequest,
  token: string,
  authBase: string
): Promise<PendingVerifyResult> {
  try {
    const res = await fetch(`${authBase}/api/trpc/pendingSignupVerify`, {
      body: JSON.stringify({
        id: 1,
        json: { token },
      }),
      cache: "no-store",
      headers: authInternalHeaders({
        "content-type": "application/json",
        "user-agent": req.headers.get("user-agent") ?? "",
        "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
        "x-real-ip": req.headers.get("x-real-ip") ?? "",
      }),
      method: "POST",
    });

    const data = (await res.json().catch(() => ({}) as unknown)) as
      | {
          result?: {
            data?: {
              json?: { success?: boolean; email?: string; password?: string };
            };
          };
        }
      | { success?: boolean };

    // @ts-expect-error loose parsing for cross-shape tolerance
    const wrapped = data.result?.data;
    const isSuccess =
      (wrapped &&
        (wrapped.success === true || wrapped?.json?.success === true)) ||
      // @ts-expect-error loose parsing
      data.success === true;

    if (!isSuccess) {
      return false;
    }

    const jsonData = wrapped?.json || wrapped;
    const email = jsonData?.email;
    const password = jsonData?.password;

    if (email && password) {
      return {
        data: { email, password },
        ok: true,
      };
    }

    return { ok: true };
  } catch {
    return false;
  }
}

async function attemptAutoLogin(
  req: NextRequest,
  authBase: string,
  email: string,
  password: string
): Promise<Response | null> {
  try {
    const loginRes = await fetch(`${authBase}/api/auth/sign-in/email`, {
      body: JSON.stringify({
        email,
        password,
      }),
      credentials: "include",
      headers: authInternalHeaders({
        "content-type": "application/json",
        "user-agent": req.headers.get("user-agent") ?? "",
      }),
      method: "POST",
    });

    if (!loginRes.ok) {
      return null;
    }

    const setCookieHeaders = loginRes.headers.getSetCookie();
    const response = Response.json(
      { autoLoggedIn: true, ok: true },
      { status: 200 }
    );

    if (setCookieHeaders) {
      for (const cookie of setCookieHeaders) {
        response.headers.append("Set-Cookie", cookie);
      }
    }

    return response;
  } catch (loginError) {
    debugLog.api("Auto-login failed after verification", {
      error:
        loginError instanceof Error ? loginError.message : String(loginError),
    });
    return null;
  }
}

async function handleVerificationFallback(
  req: NextRequest,
  authBase: string,
  token: string
): Promise<Response> {
  const url = `${authBase}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: authInternalHeaders({
      "user-agent": req.headers.get("user-agent") ?? "",
    }),
    method: "GET",
  });

  const data = await res.json().catch(() => ({}) as unknown);
  const wrapped = data as { success?: boolean; data?: { success?: boolean } };
  const isVerified = wrapped.success === true || wrapped.data?.success === true;

  return Response.json({ ok: isVerified }, { status: isVerified ? 200 : 400 });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return Response.json(
      { error: "missing-token", ok: false },
      { status: 400 }
    );
  }

  const authBase = getAuthBaseUrl();

  try {
    try {
      const sessionRes = await fetch(`${authBase}/api/auth/get-session`, {
        headers: authInternalHeaders({
          cookie: req.headers.get("cookie") ?? "",
        }),
      });

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json().catch(() => null);

        if (sessionData?.user) {
          return Response.json({ ok: true }, { status: 200 });
        }
      }
    } catch {
      // Ignore session check errors and continue with token verification
    }

    const pendingResult = await tryPendingSignupVerification(
      req,
      token,
      authBase
    );

    if (
      pendingResult &&
      typeof pendingResult === "object" &&
      pendingResult.ok &&
      "data" in pendingResult &&
      pendingResult.data
    ) {
      const autoLoginResponse = await attemptAutoLogin(
        req,
        authBase,
        pendingResult.data.email,
        pendingResult.data.password
      );

      if (autoLoginResponse) {
        return autoLoginResponse;
      }
    }

    if (
      pendingResult &&
      typeof pendingResult === "object" &&
      pendingResult.ok
    ) {
      return Response.json({ ok: true }, { status: 200 });
    }

    return await handleVerificationFallback(req, authBase, token);
  } catch {
    return Response.json(
      { error: "network-error", ok: false },
      { status: 502 }
    );
  }
}
