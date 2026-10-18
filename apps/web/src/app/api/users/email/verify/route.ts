import { accountResolutionStore } from "@asm/auth/core";
import { recoveryEmail } from "@asm/auth/validation";
import { prisma } from "@asm/db";
import { z } from "zod";

import {
  accountNotices,
  noticeTimestamp,
  queueNotice,
} from "@/lib/auth/account-notices";
import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth/auth-internal";
import { getSessionFromApi } from "@/lib/auth/session";

const verifyEmailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  otp: z.string().min(4, "Please enter the verification code"),
  verificationId: z.uuid().optional(),
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

  // Capture the address being replaced before the change commits: the notice
  // deliberately goes to the OLD mailbox, because the whole point is to tell
  // someone who may no longer control the new one.
  const previousEmail = recoveryEmail(session.user.email) ?? null;

  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const cookie = hdrs.get("cookie") || "";

  if (parsed.data.verificationId) {
    const id = parsed.data.verificationId;
    const pending = await accountResolutionStore.read(id);
    if (
      !pending ||
      pending.state.userId !== session.user.id ||
      pending.state.sessionId !== session.session.id ||
      pending.state.kind !== "email" ||
      pending.state.email !== email.toLowerCase()
    ) {
      return Response.json(
        { error: "This email verification expired. Start again." },
        { status: 400 }
      );
    }
    const response = await fetch(
      `${getAuthBaseUrl()}/api/auth/account-resolution/code`,
      {
        body: JSON.stringify({
          email: email.toLowerCase(),
          id,
          otp,
          side: "collision",
        }),
        headers: authInternalHeaders({
          "content-type": "application/json",
          cookie,
          ...(hdrs.get("authorization")
            ? { authorization: hdrs.get("authorization") ?? "" }
            : {}),
        }),
        method: "POST",
      }
    );
    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ message: "Verification failed." }));
      return Response.json(
        { error: data.message || "Verification failed." },
        { status: response.status }
      );
    }
    return Response.json({ collisionId: id, success: true });
  }
  // A racing signup must not turn an ordinary email change into an implicit merge.
  const existing = await prisma.orm.public.Users.select("id")
    .where((row) =>
      row.email.ilike(email.toLowerCase().replaceAll(/[\\%_]/g, "\\$&"))
    )
    .first();
  if (existing && existing.id !== session.user.id) {
    return Response.json(
      {
        error:
          "This email is now used by another account. Restart the email change to review both accounts.",
      },
      { status: 409 }
    );
  }

  const response = await fetch(
    `${getAuthBaseUrl()}/api/auth/email-otp/change-email`,
    {
      body: JSON.stringify({ newEmail: email, otp }),
      headers: authInternalHeaders({
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(hdrs.get("authorization")
          ? { authorization: hdrs.get("authorization") ?? "" }
          : {}),
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

  // The change is committed. Tell the old mailbox where the notice matters.
  if (previousEmail && previousEmail !== email) {
    queueNotice(() =>
      accountNotices.emailChanged({
        changedAt: noticeTimestamp(),
        newEmail: email,
        recipient: previousEmail,
      })
    );
  }

  return Response.json({ success: true });
}
