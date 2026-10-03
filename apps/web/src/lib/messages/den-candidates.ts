import { and, groupAddRefusal, prisma } from "@asm/db";
import type { GroupAddPolicy, GroupAddRefusal } from "@asm/db";

// Candidate screening for adding people to a den.
//
// Every check is a single bulk query over the whole id list rather than a loop.
// The roster arrives as an array the client controls, and a per-id round trip
// would make a 100-member den cost 100 sequential queries on the create path.
//
// What is NOT checked here is the thing this file used to check last: blocks. A
// den admits regardless of who blocks whom, so there is no block predicate to
// write and no roster-side query to run for one. `areAnyBlockedBetween` and its
// single-actor wrapper were removed rather than left unused, because a helper
// that answers a question the product has stopped asking is a helper the next
// reader will wire up by mistake. The reasoning is in the header of
// `apps/web/src/lib/messages/blocks.ts`.

export async function doUsersExist(userIds: string[]): Promise<string[]> {
  const found = await prisma.orm.public.Users.select("id")
    .where((user) => user.id.in(userIds))
    .all();
  const present = new Set(found.map((row) => row.id));
  return userIds.filter((id) => !present.has(id));
}

// A member without a message identity cannot be wrapped for, so admitting one
// would create a den that could never be read by everybody in it.
export async function areUsersMissingMessageIdentity(
  userIds: string[]
): Promise<string[]> {
  const withIdentity = await prisma.orm.public.MessageIdentities.select(
    "userId"
  )
    .where((identity) => identity.userId.in(userIds))
    .all();
  const present = new Set(withIdentity.map((row) => row.userId));
  return userIds.filter((id) => !present.has(id));
}

export async function areUsersNotFollowedBy(
  followerId: string,
  userIds: string[]
): Promise<string[]> {
  const follows = await prisma.orm.public.Follows.select("followingId")
    .where((follow) =>
      and(follow.followerId.eq(followerId), follow.followingId.in(userIds))
    )
    .all();
  const followed = new Set(follows.map((row) => row.followingId));
  return userIds.filter((id) => !followed.has(id));
}

// Which of these candidates the actor may put in a group, and why not for the
// rest.
//
// Two bulk queries, never one per candidate: the roster arrives as an array the
// client controls and a per-id round trip would make a full den cost a hundred
// sequential reads on the create path.
//
// The follow question is asked in the only direction that is the candidate's
// business - "does this candidate follow the actor" - because that is the edge
// `FOLLOWING_ONLY` is written against. The actor's own following list is
// deliberately not consulted: nobody is stopped for who they do not follow.
export async function groupAddEligibility(
  actorId: string,
  candidateIds: readonly string[]
): Promise<Map<string, GroupAddRefusal | null>> {
  const unique = [...new Set(candidateIds)].filter((id) => id !== actorId);
  const eligibility = new Map<string, GroupAddRefusal | null>();
  if (unique.length === 0) {
    return eligibility;
  }

  const [policies, following] = await Promise.all([
    prisma.orm.public.Users.select("groupAddPolicy", "id")
      .where((user) => user.id.in(unique))
      .all(),
    prisma.orm.public.Follows.select("followerId")
      .where((follow) =>
        and(follow.followingId.eq(actorId), follow.followerId.in(unique))
      )
      .all(),
  ]);
  const policyById = new Map<string, GroupAddPolicy>(
    policies.map((row) => [row.id, row.groupAddPolicy])
  );
  const followsActor = new Set(following.map((row) => row.followerId));

  for (const candidateId of unique) {
    // A candidate with no row here cannot be added for a reason the caller has
    // already reported - `doUsersExist` names the missing account - so it is left
    // out of the map rather than answered as addable.
    const policy = policyById.get(candidateId);
    if (policy === undefined) {
      continue;
    }
    eligibility.set(
      candidateId,
      groupAddRefusal(policy, followsActor.has(candidateId))
    );
  }
  return eligibility;
}

// The candidates in `candidateIds` the actor may not add, with the wording the
// picker greys them out with and the route refuses them by.
//
// The one failure for the whole set rather than one per candidate, because a
// roster is proposed as a single act: naming which of ninety-nine people is the
// problem is a worse answer than saying the roster has one.
export async function groupAddRefusalsFor(
  actorId: string,
  candidateIds: readonly string[]
): Promise<{ code: GroupAddRefusal; error: string } | null> {
  const eligibility = await groupAddEligibility(actorId, candidateIds);
  for (const refusal of eligibility.values()) {
    if (refusal !== null) {
      return { code: refusal, error: groupAddRefusalError(refusal) };
    }
  }
  return null;
}

// The route's whole sentence for a refusal.
//
// Third person, unlike the picker's row: this is an error about a proposal, and
// it has to survive being shown where the candidate is not named.
export function groupAddRefusalError(refusal: GroupAddRefusal): string {
  return refusal === "NO_DIRECT_ADDS"
    ? "Some of those people don't allow being added to groups"
    : "Some of those people only let people they follow add them";
}
