import { z } from "zod";

import { authInternalHeaders } from "@/lib/auth-internal";
import { getSessionFromApi } from "@/lib/session";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || "https://auth.localhost";

async function forwardWithUserCookie(path: string, body: unknown) {
  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const cookie = hdrs.get("cookie") || "";

  const response = await fetch(`${AUTH_BASE}${path}`, {
    body: JSON.stringify(body),
    headers: authInternalHeaders({
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    }),
    method: "POST",
  });

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    status?: boolean;
    success?: boolean;
  };

  return { data, response };
}

// Step 1: request an email change. The auth service sends an OTP to the new
// address (and to the current address, since verifyCurrentEmail is enabled);
// the address is NOT changed until the OTP is confirmed in step 2.
export async function PATCH(request: Request) {
  try {
    const session = await getSessionFromApi();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { email } = emailSchema.parse(body);

    const { data, response } = await forwardWithUserCookie(
      "/api/auth/email-otp/request-email-change",
      { newEmail: email }
    );

    if (!response.ok) {
      return Response.json(
        { error: data.message || "Failed to request email change" },
        { status: response.status }
      );
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to request email change:", error);
    return Response.json({ error: "Failed to update email" }, { status: 500 });
  }
}
