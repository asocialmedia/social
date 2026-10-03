import { and } from "@prisma/orm-postgres/orm-client";

import prisma from "../prisma";
import { groupAddRefusal } from "./dens";
import type { GroupAddPolicy, GroupAddRefusal } from "./dens";

// Reading who may be put in a group, for a whole proposed roster at once.
//
// This lives beside the rest of the den data access rather than in the web app
// because it is the same shape as `denEventNames` and `countDenMembers`: one bulk
// query per fact over an id list the client controls, with a per-id loop
// deliberately avoided. A full den is a hundred candidates, and a per-id read
// would make the create path a hundred sequential round trips.
//
// It is here rather than inside the service because it answers a question about
// accounts, not about a den: the den does not exist yet on the create path, and on
// the add path the den is irrelevant to the answer. The service still owns every
// rule about the den itself.

// Which of these candidates `actorId` may put in a group, and why not for the rest.
//
// Two queries, and the follow one is asked in the candidate's direction:
// `followingId` is the actor and `followerId` is the candidate, which is the edge
// `FOLLOWING_ONLY` is defined against. The actor's own following list is not
// consulted at all - nobody is stopped for who they do not follow.
//
// A candidate with no row in `users` is left out of the map rather than answered
// as addable. The caller already has its own existence rule and reports a missing
// account with a better message than this could.
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

// The first candidate the actor may not add, with the wording the route refuses
// the roster by.
//
// One failure for the whole set rather than one per candidate, because a roster is
// proposed as a single act: naming which of ninety-nine people is the problem is a
// worse answer than saying the roster has one.
export async function groupAddRefusalFor(
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
// Third person, unlike the picker's row: this is an error about a proposal, and it
// has to survive being shown where the candidate is not named.
export function groupAddRefusalError(refusal: GroupAddRefusal): string {
  return refusal === "NO_DIRECT_ADDS"
    ? "Some of those people don't allow being added to groups"
    : "Some of those people only let people they follow add them";
}
