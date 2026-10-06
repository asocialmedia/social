import { createDenInvite, isDenInviteDurationDays } from "@asm/db";
import type { DenInviteDurationDays } from "@asm/db";

import { denErrorResponse, requireApiUser } from "@/lib/messages/den-api";
import {
  DEN_INVITE_ROTATE_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import { parseJsonBody } from "@/lib/messages/server";

interface Params {
  params: Promise<{ id: string }>;
}

// Mints a fresh invite link for the den, manager only.
//
// This is the revocation step and the "it expired, give me another" step. The
// body carries the expiry preset the manager picked - one of the day presets, or
// null for a link that never expires - and the server computes the expiry from
// its own clock, so the lifetime of a link is never decided by a client
// timestamp. An absent body reads as null, which is what keeps the route usable
// before the picker existed and makes "never" the forgiving default.
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  // Its own budget, and a tighter one than the single-row operations it used to
  // share a bucket with. Minting retires a link that other people may be
  // holding right now, so a loop here breaks a door for innocents rather than
  // only spending the caller's own database time - which is a stronger reason to
  // bound it than cost alone.
  const limited = await consumeDenRateLimit(
    DEN_INVITE_ROTATE_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  // The duration is a whitelist decision, not a range check: an arbitrary number
  // of days would let a caller mint a ten-year link the UI never offered, and
  // coercing an unknown value silently would give them a link whose real
  // lifetime they did not ask for. Absent body or absent field is null.
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
    const invite = await createDenInvite(id, user.userId, durationDays);
    return Response.json({
      inviteCode: invite.inviteCode,
      inviteExpiresAt: invite.inviteExpiresAt?.toISOString() ?? null,
      ok: true,
    });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.invite.rotate",
      userId: user.userId,
    });
  }
}
