import {
  DEN_LIMITS,
  addDenMembers,
  prisma,
  requireDenMembership,
} from "@asm/db";

import {
  denErrorResponse,
  objectOf,
  readJsonBody,
  requireApiUser,
} from "@/lib/messages/den-api";
import {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  denCandidateFailureResponse,
  parseMemberIds,
  validateDenRoster,
} from "@/lib/messages/den-roster";

interface Params {
  params: Promise<{ id: string }>;
}

// Hard ceiling on one page, whatever the caller asks for. Without a cap a
// crafted ?limit=100000 asks Postgres for the whole roster of a 100-member den.
const MAX_LIMIT = DEN_LIMITS.membersMax;
const DEFAULT_LIMIT = 50;

// The den roster, ordered owner first, then admins, then members by join order.
//
// Managers see the same list as everybody else: the identities are already in
// the conversation payload the thread loads, so restricting this would only mean
// the details panel renders two different rosters depending on who is asking.
export async function GET(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  try {
    // The gate. A non-member gets 403 and a DM gets 409, so this cannot become
    // a way to enumerate who is in somebody else's conversation.
    await requireDenMembership(id, user.userId);

    // `searchParams.get` answers null when the caller sent no limit, and
    // `Number(null)` is 0, which the clamp below would turn into a single member
    // for every unpaginated request. An absent or blank limit therefore takes
    // the default, and only a real number is clamped.
    const rawLimit = new URL(request.url).searchParams.get("limit");
    const requestedLimit =
      rawLimit === null || rawLimit.trim() === ""
        ? Number.NaN
        : Number(rawLimit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const rows = await prisma.orm.public.MessageConversationMembers.select(
      "invitedById",
      "role",
      "userId"
    )
      .include("user", (candidate) =>
        candidate.select(
          "avatarUrl",
          "badge",
          "badges",
          "displayName",
          "id",
          "username"
        )
      )
      .where((member) => member.conversationId.eq(id))
      .orderBy([
        (member) => member.role.asc(),
        (member) => member.createdAt.asc(),
      ])
      .limit(limit)
      .all();

    return Response.json({
      members: rows.flatMap((row) =>
        // flatMap, not map: a membership row whose user was deleted underneath
        // it is dropped rather than rendered as a nameless entry.
        row.user
          ? [
              {
                avatarUrl: row.user.avatarUrl,
                badge: row.user.badge,
                badges: row.user.badges,
                displayName: row.user.displayName,
                id: row.user.id,
                invitedById: row.invitedById,
                role: row.role,
                username: row.user.username,
              },
            ]
          : []
      ),
    });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.members.list",
      userId: user.userId,
    });
  }
}

// Adds members to a den.
//
// Returns the ids actually added, not the ids requested: a client that asked for
// five people and got three needs to know which three, because the root key has
// to be rotated for exactly those.
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }
  const { id } = await params;

  const parsed = parseMemberIds(
    objectOf(await readJsonBody(request))?.memberIds
  );
  if (parsed.failure) {
    return denCandidateFailureResponse(parsed.failure);
  }
  if (parsed.memberIds.length === 0) {
    return Response.json({ error: "memberIds is required" }, { status: 400 });
  }

  const limited = await consumeDenRateLimit(
    DEN_ADD_MEMBERS_RATE_LIMIT,
    user.userId
  );
  if (limited) {
    return limited;
  }

  try {
    // requireFollow: a direct add is the same deliberate act as starting a DM, so
    // the follow rule applies exactly as it does there. Nothing else is checked
    // about the relationship between a candidate and the room - a den admits
    // regardless of blocks, so there is no block rule for the service to
    // re-check under its claim lock either. The cap is, so the roster is read
    // here for the count.
    const roster = await listMemberIds(id);
    const failure = await validateDenRoster(user.userId, parsed.memberIds, {
      currentMemberCount: roster.length,
      requireFollow: true,
    });
    if (failure) {
      return denCandidateFailureResponse(failure);
    }

    const added = await addDenMembers(id, user.userId, parsed.memberIds);
    return Response.json({ added, ok: true }, { status: 201 });
  } catch (error) {
    return denErrorResponse(error, {
      denId: id,
      operation: "den.members.add",
      userId: user.userId,
    });
  }
}

// One read for the cap pre-check. A den holds at most DEN_LIMITS.membersMax
// people, so the ids are a bounded payload and their count is all the pre-check
// needs. It used to read them for a block check as well, which is why it reads
// ids rather than counting - there is nothing left that needs to know WHO is
// inside, only how many, so an aggregate would do.
async function listMemberIds(conversationId: string): Promise<string[]> {
  const rows = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where((member) => member.conversationId.eq(conversationId))
    .all();
  return rows.map((row) => row.userId);
}
