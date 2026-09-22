import { sendVerificationLink } from "@/app/(auth)/signup/actions";

// Native-facing "verify via email link" endpoint. The web form calls the
// `sendVerificationLink` Server Action directly, which a native client cannot
// invoke; this exposes the same action over a plain POST, exactly like
// ../resend/route.ts does for the OTP re-send.
//
// Exempt from the install-token gate alongside /api/signup: it is part of the
// signup bootstrap, and the auth service already rate-limits it per email and
// per IP (pendingSignupSendLink is a strict-path tRPC procedure).
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => {
    /* empty */
  });
  const email =
    typeof body === "object" && body !== null && "email" in body
      ? (body as { email?: unknown }).email
      : undefined;

  if (typeof email !== "string" || email.trim().length === 0) {
    return Response.json(
      { error: "An email address is required", success: false },
      { status: 400 }
    );
  }

  const result = await sendVerificationLink(email.trim());
  if (result.success) {
    return Response.json(result, { status: 200 });
  }
  return Response.json(result, { status: result.rateLimited ? 429 : 400 });
}
