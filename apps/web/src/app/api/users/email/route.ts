import {
  accountResolutionStore,
  newAccountResolutionState,
} from "@asm/auth/core";
import { recoveryEmail } from "@asm/auth/validation";
import { consumeRateLimit, prisma } from "@asm/db";
import { z } from "zod";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth/auth-internal";
import { getSessionFromApi } from "@/lib/auth/session";

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
  const authorization = hdrs.get("authorization");

  const response = await fetch(`${getAuthBaseUrl()}${path}`, {
    body: JSON.stringify(body),
    headers: authInternalHeaders({
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
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
  const hasCurrentEmail = Boolean(recoveryEmail(session.user.email));

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
  const email = parsed.data.email.trim().toLowerCase();
  const { otp } = parsed.data;
  if (email === session.user.email?.toLowerCase()) {
    return Response.json(
      { error: "This email already belongs to your account." },
      { status: 400 }
    );
  }
  const rate = await consumeRateLimit({
    bucket: "email-change",
    identifier: session.user.id,
    limit: 5,
    windowSeconds: 300,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Wait a few minutes before trying again." },
      { status: 429 }
    );
  }

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

  const existing = await prisma.orm.public.Users.select("id")
    .where((row) => row.email.ilike(email.replaceAll(/[\\%_]/g, "\\$&")))
    .first();
  if (existing && existing.id !== session.user.id) {
    const id = crypto.randomUUID();
    await accountResolutionStore.create(
      id,
      newAccountResolutionState(session.user.id, session.session.id, {
        email,
        kind: "email",
        otherUserId: existing.id,
      })
    );
    const result = await forwardWithUserCookie(
      "/api/auth/account-resolution/code",
      { email, id, side: "collision" }
    );
    if (!result.response.ok) {
      return Response.json(
        { error: result.data.message || "Could not send a verification code." },
        { status: result.response.status }
      );
    }
    // Do not disclose the other profile until the new inbox has been verified.
    return Response.json({ success: true, verificationId: id });
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
