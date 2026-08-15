import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth-internal";
import { getSessionFromApi } from "@/lib/session";

// Sends a verification OTP to the user's current email address so they can
// prove ownership before changing it. Only meaningful for accounts that
// already have an email (Reddit signups have none and skip this step).
export async function POST() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const currentEmail = session.user.email;
  if (!currentEmail) {
    return Response.json(
      { error: "No email on this account" },
      { status: 400 }
    );
  }

  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const cookie = hdrs.get("cookie") || "";

  const response = await fetch(
    `${getAuthBaseUrl()}/api/auth/email-otp/send-verification-otp`,
    {
      body: JSON.stringify({ email: currentEmail, type: "email-verification" }),
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
      { error: data.message || "Failed to send verification code" },
      { status: response.status }
    );
  }

  return Response.json({ success: true });
}
