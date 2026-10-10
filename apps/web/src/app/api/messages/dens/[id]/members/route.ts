import {
  DEN_LIMITS,
  addDenMembers,
  and,
  filterBannedUserIds,
  prisma,
  requireDenManager,
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

// The den roster, ordered owner first, then elders, then members by join order.
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

    // `leftAt IS NULL`, so somebody who left or was removed drops off the roster
    // rather than lingering in it as a member who cannot act. Their row stays -
    // that is what preserves their history - but a roster is a list of who is in
    // the room now, and a name on it that cannot be messaged, promoted or removed
    // reads as a bug in the room rather than as history.
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
      .where((member) =>
        and(member.conversationId.eq(id), member.leftAt.isNull())
      )
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
    // Authority FIRST. The ban pre-check below discloses, and it is the only thing in
    // this route that does: it names the banned person, and the naming reads
    // `Users.displayName` for caller-supplied ids with no membership in the den. Run
    // before `requireDenManager` - which lives inside `addDenMembers` - that made the
    // refusal a per-id oracle over a list the feature states is manager-only, available
    // to anybody who could sign in. A non-manager learns who is banned from a den they
    // are not even in, and learns their display name for free.
    //
    // The sibling GET on this file gates with `requireDenMembership` before touching the
    // roster, and this is the same discipline one step stricter.
    await requireDenManager(id, user.userId);

    // A banned candidate is refused HERE, before the roster is even read, so the
    // manager is told which person is the problem rather than being handed a generic
    // failure for a batch of five. `addDenMembers` re-checks the same fact under its
    // claim lock, which is the check that is actually load-bearing: this one exists so
    // the refusal names somebody, and a race between the two is closed by the service
    // rather than by this read.
    //
    // Before the cap for the same reason the join door checks it before capacity: a
    // full room is the wrong answer to "why can I not add Ada".
    const banned = await filterBannedUserIds(id, parsed.memberIds);
    if (banned.size > 0) {
      const bannedNames = await bannedDisplayNames([...banned]);
      const named = [...bannedNames];
      return denCandidateFailureResponse({
        code: "BANNED",
        error:
          named.length === 1
            ? `${named[0]} is banned from this den. Unban them from the banned list first.`
            : "Some of those people are banned from this den. Unban them from the banned list first.",
      });
    }

    // Each candidate's own group-add policy decides. Nothing else is checked
    // about the relationship between a candidate and the room - a den admits
    // regardless of blocks, so there is no block rule for the service to
    // re-check under its claim lock either. The cap is, so the roster is read
    // here for the count.
    const roster = await listMemberIds(id);
    const failure = await validateDenRoster(user.userId, parsed.memberIds, {
      currentMemberCount: roster.length,
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

// Display names for a refusal that has to name somebody.
//
// Falls back to a username rather than an empty string, because " is banned from this
// den" is a broken sentence and the whole point of this pre-check was to name the
// person. One query for the whole set, so a batch of five costs one round trip.
async function bannedDisplayNames(userIds: string[]): Promise<string[]> {
  const rows = await prisma.orm.public.Users.select(
    "displayName",
    "id",
    "username"
  )
    .where((user) => user.id.in(userIds))
    .all();
  const byId = new Map(
    rows.map((row) => [row.id, row.displayName || row.username])
  );
  return userIds.map((id) => byId.get(id) ?? "That person");
}

// One read for the cap pre-check. A den holds at most DEN_LIMITS.membersMax
// people, so the ids are a bounded payload and their count is all the pre-check
// needs. It used to read them for a block check as well, which is why it reads
// ids rather than counting - there is nothing left that needs to know WHO is
// inside, only how many, so an aggregate would do.
// Current members only, for the same reason the roster is: departed rows are
// history, and counting them would refuse a perfectly legal add. A den that had
// churned through two hundred people would report two hundred and turn away
// everybody, which is precisely the backwards cap `addDenMembers` warns about -
// the ceiling is about how much noise a live den has, not how many rows the
// table kept. The service re-checks under the claim lock regardless; this is
// only the cheap pre-check.
async function listMemberIds(conversationId: string): Promise<string[]> {
  const rows = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where((member) =>
      and(member.conversationId.eq(conversationId), member.leftAt.isNull())
    )
    .all();
  return rows.map((row) => row.userId);
}
