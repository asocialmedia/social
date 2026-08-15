import { z } from "zod";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth-internal";
import { getSessionFromApi } from "@/lib/session";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

// Optional current-email OTP (required when the account already has an email).
const emailChangeRequestSchema = emailSchema.extend({
  otp: z.string().min(4).optional(),
});

async function forwardWithUserCookie(path: string, body: unknown) {
  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const cookie = hdrs.get("cookie") || "";

  const response = await fetch(`${getAuthBaseUrl()}${path}`, {
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

// Step 1: request an email change. When the account already has an email, the
// caller must first confirm ownership of it with the OTP sent to the current
// address (verified here). The auth service then mails a code to the new
// address; the address is NOT changed until that code is confirmed in step 2.
export async function PATCH(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const hasCurrentEmail = Boolean(session.user.email);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = emailChangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Please enter a valid email address" },
      { status: 400 }
    );
  }
  const { email, otp } = parsed.data;

  // Accounts with an existing email must verify the current address with its
  // OTP before the change is allowed to proceed.
  if (hasCurrentEmail && !otp) {
    return Response.json(
      { error: "Verification code is required" },
      { status: 400 }
    );
  }

  if (hasCurrentEmail) {
    const verify = await forwardWithUserCookie(
      "/api/auth/email-otp/verify-email",
      { email: session.user.email, otp }
    );
    if (!verify.response.ok) {
      return Response.json(
        { error: verify.data.message || "Verification code is invalid" },
        { status: 400 }
      );
    }
  }

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
}
