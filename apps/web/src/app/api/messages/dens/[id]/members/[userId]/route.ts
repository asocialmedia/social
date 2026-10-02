import { removeDenMember } from "@asm/db";

import { denErrorResponse, requireApiUser } from "@/lib/messages/den-api";
import {
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string; userId: string }>;
}

// Removes a member from a den. Manager only; the owner cannot be removed, and
// self-removal is refused here so it always goes through `leave`, which carries
// the ownership-transfer logic that a plain delete would skip.
export async function DELETE(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id, userId } = await params;

  const limited = await consumeDenRateLimit(
    DEN_REMOVE_MEMBER_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  try {
    await removeDenMember(id, user.userId, userId);
    return Response.json({ ok: true });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.members.remove",
      userId: user.userId,
    });
  }
}
