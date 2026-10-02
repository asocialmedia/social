import { rotateInviteCode } from "@asm/db";

import { denErrorResponse, requireApiUser } from "@/lib/messages/den-api";
import {
  DEN_INVITE_ROTATE_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string }>;
}

// Rotates a den's join code, manager only.
//
// This is the revocation step: the old code stops resolving the moment this
// returns, so a code that leaked into a screenshot or a forwarded thread can be
// retired without dissolving the den or removing whoever joined with it.
export async function POST(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  // Its own budget, and a tighter one than the single-row operations it used to
  // share a bucket with. Rotating retires a link that other people may be
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

  try {
    const inviteCode = await rotateInviteCode(id, user.userId);
    return Response.json({ inviteCode, ok: true });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.invite.rotate",
      userId: user.userId,
    });
  }
}
