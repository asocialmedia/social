import { unbanDenMember } from "@asm/db";

import { denErrorResponse, requireApiUser } from "@/lib/messages/den-api";
import {
  DEN_BAN_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string; userId: string }>;
}

// Lets somebody come back.
//
// Restores eligibility and nothing else: no membership row is written, no roster line
// is added, and `membershipSeq` does not move. Putting somebody back into a
// conversation is a separate, visible act, because silently restoring them would hand
// them a transcript they never agreed to read again and would do it without a line in
// the log saying so. Re-adding is the add control a manager already has.
//
// Shares the ban bucket rather than getting one. It is the same manager decision in
// the other direction, it needs no confirmation of its own, and a second budget could
// only ever be the looser of the pair.
//
// Idempotent, and the 204 says so: an unban of somebody who is not banned finds no row
// to delete and still answers success, because "this person may return" is true
// afterwards either way and two managers pressing the button at once is not an error.
export async function DELETE(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id, userId } = await params;

  const limited = await consumeDenRateLimit(DEN_BAN_RATE_LIMIT, user.userId);
  if (limited) {
    return limited;
  }

  try {
    await unbanDenMember(id, user.userId, userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.bans.delete",
      userId: user.userId,
    });
  }
}
