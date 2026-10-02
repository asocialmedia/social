import { and, prisma } from "@asm/db";

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
