import { fromPrismaDateTime, getPrivateUserQuery, prisma } from "@asm/db";
import type {
  CommunityRoleRow,
  PrivateUserData as DatabasePrivateUserData,
} from "@asm/db";
import { cache } from "react";

import { getSessionFromApi } from "@/lib/auth/session";

// The logged-in user's own data: private fields (storage keys, provider ids,
// email) are only ever returned for the session owner and never embedded in
// public profile payloads. The session is re-checked here so a caller can
// never fetch private fields for an arbitrary userId.
export type PrivateUserData = Omit<
  DatabasePrivateUserData,
  "communityMembers" | "createdAt" | "followsFollows"
> & {
  communityMemberships: CommunityRoleRow[];
  createdAt: Date;
  followers: { followerId: string }[];
};

export const getUserData = cache(async (userId: string) => {
  const session = await getSessionFromApi();
  if (!session?.user || session.user.id !== userId) {
    return null;
  }

  const userData = await getPrivateUserQuery(prisma.orm, userId)
    .where({ id: userId })
    .first();

  if (!userData) {
    return null;
  }

  const { communityMembers, createdAt, followsFollows, ...scalars } = userData;
  return {
    ...scalars,
    communityMemberships: communityMembers.flatMap((membership) =>
      membership.community
        ? [
            {
              community: membership.community,
              role: membership.role,
            },
          ]
        : []
    ),
    createdAt: fromPrismaDateTime(createdAt),
    followers: followsFollows,
  };
});
