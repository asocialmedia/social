import { getSessionFromApi } from "@/lib/session";
import { suggestedUsersCache } from "@/lib/suggested-users-cache";

export type { UserData } from "@asm/db";

import { getUserDataSelect, Prisma, prisma, redis } from "@asm/db";

const RECENTLY_SHOWN_CACHE_KEY = (userId: string) =>
  `recently-shown-users:${userId}`;
const RECENTLY_SHOWN_TTL = 3600;

export async function GET(_req: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;

    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const cachedData = await suggestedUsersCache.get(user.id);
    if (cachedData) {
      return Response.json(cachedData);
    }

    const recentlyShownKey = RECENTLY_SHOWN_CACHE_KEY(user.id);
    const recentlyShown = (await redis.smembers(recentlyShownKey)) || [];

    const suggestedUsers = await prisma.user.findMany({
      take: 15,
      orderBy:
        Math.random() > 0.3
          ? { aura: Prisma.SortOrder.desc }
          : {
              followers: {
                _count: Prisma.SortOrder.desc,
              },
            },
      where: {
        AND: [
          { id: { not: user.id } },
          { id: { notIn: recentlyShown } },
          {
            followers: {
              none: {
                followerId: user.id,
              },
            },
          },
        ],
      },
      select: {
        ...getUserDataSelect(user.id),
        aura: true,
        followers: {
          where: {
            follower: {
              followers: {
                some: {
                  followerId: user.id,
                },
              },
            },
          },
          select: {
            follower: {
              select: {
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    const selectedUsers = suggestedUsers
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);

    await Promise.all(
      selectedUsers.map((selectedUser) =>
        redis.sadd(recentlyShownKey, selectedUser.id)
      )
    );
    await redis.expire(recentlyShownKey, RECENTLY_SHOWN_TTL);

    const transformedUsers = selectedUsers.map((selectedUser) => ({
      ...selectedUser,
      mutualFollowers: selectedUser.followers.map((f) => f.follower),
    }));

    await suggestedUsersCache.set(user.id, transformedUsers);

    return Response.json(transformedUsers);
  } catch (error) {
    console.error("Error fetching suggested users:", error);
    return Response.json(
      { error: "Failed to fetch suggested users" },
      { status: 500 }
    );
  }
}
