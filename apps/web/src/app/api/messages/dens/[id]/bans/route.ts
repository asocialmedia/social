import { banDenMember, listDenBans, normalizeDenBanReason } from "@asm/db";

import {
  denErrorResponse,
  objectOf,
  readJsonBody,
  requireApiUser,
} from "@/lib/messages/den-api";
import {
  DEN_BAN_RATE_LIMIT,
  DEN_BANS_LIST_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

interface Params {
  params: Promise<{ id: string }>;
}

// Who cannot come back to this den.
//
// Manager only, and the gate is `listDenBans`'s own `requireDenManager` rather than
// one written here, so a plain member is refused for the same reason they would be by
// the remove route and with the same status. There is no shape of this payload a
// non-manager can read: no count, no ids, not even an empty array.
//
// Why a plain member gets nothing rather than a redacted list. A ban is a decision
// about a person made by somebody else in the room, and the room's members are not
// party to it - which is the same reason `announceAudienceIds` keeps departed people
// out of roster announcements. A member who can see that "Grace is banned" learns who
// fell out with whom, and that is not theirs to know.
//
// The names are read live rather than snapshotted, so somebody who was banned and has
// since changed their display name appears under the new one here too. The ban row
// stores no name columns on purpose; see `den-bans.ts`.
export async function GET(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  const limited = await consumeDenRateLimit(
    DEN_BANS_LIST_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  try {
    const bans = await listDenBans(id, user.userId);
    return Response.json({
      bans: bans.map((ban) => ({
        avatarUrl: ban.avatarUrl,
        bannedById: ban.bannedById,
        bannedByName: ban.bannedByName,
        createdAt: ban.createdAt.toISOString(),
        displayName: ban.displayName,
        id: ban.userId,
        reason: ban.reason,
        username: ban.username,
      })),
    });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.bans.list",
      userId: user.userId,
    });
  }
}

// Keeps somebody out of a den.
//
// Separate from the remove route on purpose, and the split is the whole product
// decision: `DELETE /members/:userId` ends access and grants nothing about the
// future, which is what somebody removed in error needs. This one also closes the
// door, and is the only way back to it is `DELETE /bans/:userId`.
//
// Two shapes, decided in the service rather than here, because the difference has to
// be decided under the claim lock:
//
//   - Somebody still inside is removed AND banned in one transaction, so there is no
//     instant at which they are out of the den but still able to walk back in.
//   - Somebody already out only gets the ban row. There is nobody to remove and no
//     roster to move, so a removal stamp would be a second row describing an event
//     that did not just happen.
//
// The reason is optional and trimmed server-side, and a malformed one is a 400 rather
// than being coerced: silently accepting `reason: 7` would store the string "7" as a
// moderator's justification, which is worse than telling them the field is wrong.
//
// This route adds no group-add check, no identity check and no follow check, because
// none of them apply. A person is banned precisely after somebody with authority over
// the room decided they should not be in it, and re-litigating their own privacy
// settings at the moment of exclusion would be both meaningless and a way to make the
// exclusion fail for the wrong reason.
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

  const reason = normalizeDenBanReason(body?.reason);
  if (!reason.ok) {
    return Response.json({ error: "reason must be a string" }, { status: 400 });
  }

  const limited = await consumeDenRateLimit(DEN_BAN_RATE_LIMIT, user.userId);
  if (limited) {
    return limited;
  }

  try {
    await banDenMember(id, user.userId, targetUserId, {
      reason: reason.reason,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.bans.create",
      userId: user.userId,
    });
  }
}
