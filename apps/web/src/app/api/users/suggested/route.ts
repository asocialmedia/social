import {
  getUserDataSelect,
  Prisma,
  prisma,
  redis,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/session";
import { suggestedUsersCache } from "@/lib/suggested-users-cache";

export type { UserData } from "@asm/db";

const RECENTLY_SHOWN_CACHE_KEY = (userId: string) =>
  `recently-shown-users:${userId}`;
const RECENTLY_SHOWN_TTL = 3600;

export async function GET(_req: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;

    if (!user) {
      // Guests get a generic set of popular users instead of the personalised
      // (and per-user cached) suggestions.
      const guestUsers = await prisma.user.findMany({
        orderBy: { aura: Prisma.SortOrder.desc },
        select: { ...getUserDataSelect(""), aura: true },
        take: 6,
        where: { id: { not: SYSTEM_MODERATION_USER_ID } },
      });
      return Response.json(guestUsers);
    }

    const cachedData = await suggestedUsersCache.get(user.id);
    if (cachedData) {
      // Cached suggestions may predate the system-user exclusion (or include it
      // via an old write), so filter before returning.
      const visible = (cachedData as { id: string }[]).filter(
        (cached) => cached.id !== SYSTEM_MODERATION_USER_ID
      );
      return Response.json(visible);
    }

    const recentlyShownKey = RECENTLY_SHOWN_CACHE_KEY(user.id);
    const recentlyShown = (await redis.smembers(recentlyShownKey)) || [];

    const suggestedUsers = await prisma.user.findMany({
      orderBy:
        Math.random() > 0.3
          ? { aura: Prisma.SortOrder.desc }
          : {
              followers: {
                _count: Prisma.SortOrder.desc,
              },
            },
      select: {
        ...getUserDataSelect(user.id),
        aura: true,
        followers: {
          select: {
            follower: {
              select: {
                avatarUrl: true,
                displayName: true,
                username: true,
              },
            },
          },
          where: {
            follower: {
              followers: {
                some: {
                  followerId: user.id,
                },
              },
            },
          },
        },
      },
      take: 15,
      where: {
        AND: [
          { id: { not: user.id } },
          { id: { not: SYSTEM_MODERATION_USER_ID } },
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
    });

    let candidates = suggestedUsers;
    if (candidates.length === 0) {
      // Pool exhausted (e.g. few users total): fall back to any user the
      // viewer isn't already following, so the widget never renders empty.
      candidates = await prisma.user.findMany({
        orderBy: { aura: Prisma.SortOrder.desc },
        select: {
          ...getUserDataSelect(user.id),
          aura: true,
          followers: {
            select: {
              follower: {
                select: {
                  avatarUrl: true,
                  displayName: true,
                  username: true,
                },
              },
            },
            where: {
              follower: {
                followers: {
                  some: {
                    followerId: user.id,
                  },
                },
              },
            },
          },
        },
        take: 15,
        where: {
          AND: [
            { id: { not: user.id } },
            { id: { not: SYSTEM_MODERATION_USER_ID } },
            {
              followers: {
                none: {
                  followerId: user.id,
                },
              },
            },
          ],
        },
      });
    }

    const selectedUsers = candidates
      .toSorted(() => Math.random() - 0.5)
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
