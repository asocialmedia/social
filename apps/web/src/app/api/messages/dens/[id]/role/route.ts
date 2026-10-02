import { setDenMemberRole } from "@asm/db";

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

// Promotes or demotes a member. Owner only, and only ADMIN and MEMBER are
// assignable: ownership moves by leaving or by dissolving, never by promotion,
// so there is exactly one way it can change and no second owner to reconcile.
//
// The role is validated here as well as in the service so a crafted body is a
// 400 rather than a round trip that ends in a domain error.
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  const body = objectOf(await readJsonBody(request));
  const role = body?.role;
  const targetUserId = body?.userId;
  if (role !== "ADMIN" && role !== "MEMBER") {
    return Response.json(
      { error: "That role cannot be assigned" },
      { status: 400 }
    );
  }
  if (typeof targetUserId !== "string" || targetUserId.length === 0) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }

  const limited = await consumeDenRateLimit(DEN_ROLES_RATE_LIMIT, user.userId);
  if (limited) {
    return limited;
  }

  try {
    await setDenMemberRole(id, user.userId, targetUserId, role);
    return Response.json({ ok: true, role });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.role.set",
      userId: user.userId,
    });
  }
}
