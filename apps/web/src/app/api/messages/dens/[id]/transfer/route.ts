import { transferDenOwnership } from "@asm/db";

import {
  denErrorResponse,
  objectOf,
  readJsonBody,
  requireApiUser,
} from "@/lib/messages/den-api";
import {
  DEN_ROLES_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string }>;
}

// Hands the den to somebody already in it. Owner only, and the caller stays in
// as an Elder, so the den, its messages and its history do not move - only who is
// in charge of them.
//
// Deliberately NOT an option on the role route. Assigning a role writes one
// membership row; a transfer writes that row, the caller's row and the den's
// `ownerId`, and those three have to land together or two sources of truth
// disagree about who can dissolve the den. Keeping it on its own route is what
// stops a caller reaching for it with a role-shaped body.
//
// The target is validated here as well as in the service, exactly as the role
// route validates its role, so a crafted body is a 400 rather than a round trip
// that ends in a domain error. The service re-checks it because everything
// checked only outside a transaction is stale by the time the row is written.
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  const body = objectOf(await readJsonBody(request));
  const targetUserId = body?.userId;
  if (typeof targetUserId !== "string" || targetUserId.length === 0) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  // The roles budget rather than a bucket of its own: a transfer is the rarest
  // management operation there is - nobody runs a loop that hands their den away -
  // and every call that succeeds is a real change of authority, which is the same
  // argument the roles bucket was written for. Sharing it also means a rename
  // storm still cannot lock an owner out of the one move only they can make.
  const limited = await consumeDenRateLimit(DEN_ROLES_RATE_LIMIT, user.userId);
  if (limited) {
    return limited;
  }

  try {
    await transferDenOwnership(id, user.userId, targetUserId);
    return Response.json({ ok: true });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.ownership.transfer",
      userId: user.userId,
    });
  }
}
