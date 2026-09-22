import { getClientIpFromHeaders } from "@asm/db";
import { headers } from "next/headers";

import {
  getSignupTurnstileConfig,
  verifySignupTurnstileToken,
} from "@/lib/auth/turnstile";
import {
  issueInstallToken,
  resolveInstallTokenSecret,
} from "@/lib/mobile/install-token";

// Native install bootstrap. Exchanges a solved Turnstile challenge for a
// signed install token, which every later no-origin request must present.
//
// This is the one endpoint a native client may reach without already holding a
// token, so it is the place bot defence belongs: the challenge is verified
// server-side against Cloudflare before anything is issued, and the token
// carries a distinct action so a signup token cannot be replayed here.
//
// Attestation (Play Integrity / App Attest) would harden this further by
// proving the caller is a genuine app on a genuine device rather than merely
// someone who solved a challenge; it belongs at this seam.
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => {
    /* empty */
  });
  const turnstileToken =
    typeof body === "object" && body !== null && "turnstileToken" in body
      ? (body as { turnstileToken?: unknown }).turnstileToken
      : undefined;

  if (typeof turnstileToken !== "string" || turnstileToken.length === 0) {
    return Response.json({ error: "security-check-required" }, { status: 400 });
  }

  const baseConfig = getSignupTurnstileConfig();
  const config = baseConfig
    ? { ...baseConfig, expectedAction: "mobile-register" }
    : undefined;

  const headersList = await headers();
  const clientIp = getClientIpFromHeaders(headersList);

  const verification = await verifySignupTurnstileToken(
    turnstileToken,
    clientIp === "unknown" ? undefined : clientIp,
    config
  );
  if (!verification.success) {
    // "configuration" means this deployment cannot verify challenges at all,
    // which is a server fault rather than a bad caller.
    const status = verification.reason === "configuration" ? 503 : 403;
    return Response.json({ error: verification.reason }, { status });
  }

  const issued = issueInstallToken(resolveInstallTokenSecret());
  if (!issued) {
    // No signing secret: issuing an unverifiable token would be worse than
    // refusing, so surface the misconfiguration instead.
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  return Response.json(
    { installId: issued.installId, token: issued.token },
    { headers: { "cache-control": "no-store" }, status: 200 }
  );
}
