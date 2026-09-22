import { resendVerificationEmail } from "@/app/(auth)/signup/actions";

// Native-facing resend endpoint. The web form calls the `resendVerificationEmail`
// Server Action directly, which a native client cannot invoke; this exposes the
// same action over a plain POST.
//
// Exempt from the install-token gate alongside /api/signup: re-sending a code is
// part of the signup bootstrap, and the auth service already rate-limits it per
// email and per IP.
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

  const result = await resendVerificationEmail(email.trim());
  // Surface rate limiting as 429 so native clients can back off instead of
  // treating it like any other validation failure.
  let status = 400;
  if (result.success) {
    status = 200;
  } else if (result.rateLimited) {
    status = 429;
  }
  return Response.json(result, { status });
}
