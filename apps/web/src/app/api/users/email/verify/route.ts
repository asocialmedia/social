import { z } from "zod";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth-internal";
import { getSessionFromApi } from "@/lib/session";

const verifyEmailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  otp: z.string().min(4, "Please enter the verification code"),
});

// Step 2: confirm an email change with the OTP sent to the new address. The
// auth service verifies the OTP and only then commits the new email, so a
// user can never change their email without proving ownership of the new one.
export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Please enter a valid email and verification code" },
      { status: 400 }
    );
  }
  const { email, otp } = parsed.data;

  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const cookie = hdrs.get("cookie") || "";

  const response = await fetch(
    `${getAuthBaseUrl()}/api/auth/email-otp/change-email`,
    {
      body: JSON.stringify({ newEmail: email, otp }),
      headers: authInternalHeaders({
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      }),
      method: "POST",
    }
  );

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
  };

  if (!response.ok) {
    return Response.json(
      { error: data.message || "Verification failed" },
      { status: response.status }
    );
  }

  return Response.json({ success: true });
}
