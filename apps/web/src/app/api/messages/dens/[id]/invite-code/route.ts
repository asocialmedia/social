import { createDenShortCode, isDenInviteDurationDays } from "@asm/db";
import type { DenInviteDurationDays } from "@asm/db";

import { denErrorResponse, requireApiUser } from "@/lib/messages/den-api";
import {
  DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import { parseJsonBody } from "@/lib/messages/server";

interface Params {
  params: Promise<{ id: string }>;
}

// Mints a fresh 6-character invite short code for the den, manager only.
//
// Like the invite link endpoint, this is the revocation step and the "it
// expired, give me another" step. The body carries the expiry preset the
// manager picked - one of the day presets, or null for a code that never
// expires - and the server computes the expiry from its own clock. An absent
// body reads as null ("never" expiry).
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  // Metered in its own bucket separate from link minting so the two doors
  // do not starve each other's rate limit budgets.
  const limited = await consumeDenRateLimit(
    DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  // Whitelisted presets only; unknown value is rejected with 400.
  let durationDays: DenInviteDurationDays | null = null;
  const body = (await parseJsonBody(request).catch(() => null)) as {
    durationDays?: unknown;
  } | null;
  if (body && "durationDays" in body && body.durationDays !== null) {
    const { durationDays: requested } = body;
    if (!isDenInviteDurationDays(requested)) {
      return Response.json({ error: "Unknown expiry preset" }, { status: 400 });
    }
    durationDays = requested;
  }

  try {
    const invite = await createDenShortCode(id, user.userId, durationDays);
    return Response.json({
      inviteShortCode: invite.inviteShortCode,
      inviteShortCodeExpiresAt:
        invite.inviteShortCodeExpiresAt?.toISOString() ?? null,
      ok: true,
    });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.invite-code.rotate",
      userId: user.userId,
    });
  }
}
