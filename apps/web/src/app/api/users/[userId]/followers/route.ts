import { debugLog } from "@asm/config/debug";
import {
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  followerInfoCache,
  prisma,
} from "@asm/db";
import type { FollowerInfo } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";
import { suggestedUsersCache } from "@/lib/suggested-users-cache";

const FOLLOW_AURA_REWARD = 5;
const FOLLOW_GIVEN_AURA_REWARD = 1;

export async function POST(
  _req: Request,
  props: { params: Promise<{ userId: string }> }
) {
  const params = await props.params;
  const { userId } = params;

  debugLog.api("Processing follow request:", userId);

  try {
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;

    if (!loggedInUser) {
      debugLog.api("Unauthorized follow attempt");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Only reward aura when the follow is actually created, so repeated
      // follow calls (double-clicks, retries) cannot farm aura.
      const existingFollow = await tx.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: loggedInUser.id,
            followingId: userId,
          },
        },
      });

      if (!existingFollow) {
        await tx.follow.create({
          data: {
            followerId: loggedInUser.id,
            followingId: userId,
          },
        });

        await tx.notification.create({
          data: {
            issuerId: loggedInUser.id,
            recipientId: userId,
            type: "FOLLOW",
          },
        });

        enqueueNotificationCreated(userId).catch((error: unknown) => {
          console.error("Failed to enqueue follow notification event:", error);
        });

        await tx.user.update({
          data: { aura: { increment: FOLLOW_AURA_REWARD } },
          where: { id: userId },
        });

        await tx.auraLog.create({
          data: {
            amount: FOLLOW_AURA_REWARD,
            issuerId: loggedInUser.id,
            type: "FOLLOW_GAINED",
            userId,
          },
        });

        // The follower also earns aura for building their network.
        await tx.user.update({
          data: { aura: { increment: FOLLOW_GIVEN_AURA_REWARD } },
          where: { id: loggedInUser.id },
        });

        await tx.auraLog.create({
          data: {
            amount: FOLLOW_GIVEN_AURA_REWARD,
            issuerId: loggedInUser.id,
            type: "FOLLOW_GIVEN",
            userId: loggedInUser.id,
          },
        });
      }

      const userData = await tx.user.findUnique({
        select: {
          _count: { select: { followers: true } },
          displayName: true,
          id: true,
          username: true,
        },
        where: { id: userId },
      });

      return { userData };
    });

    debugLog.api("Follow transaction completed:", result);

    if (!result.userData) {
      return Response.json({ error: "User data not found" }, { status: 404 });
    }

    const followerInfo: FollowerInfo & {
      displayName: string;
      username: string;
    } = {
      displayName: result.userData.displayName,
      followers: result.userData._count.followers,
      isFollowedByUser: true,
      username: result.userData.username,
    };

    await followerInfoCache.invalidate(params.userId);

    return Response.json(followerInfo);
  } catch (error) {
    debugLog.api("Follow request failed:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ userId: string }> }
) {
  const params = await props.params;
  const { userId } = params;

  try {
    // Guests can read public follower counts; they're never following anyone.
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;

    const cachedData = await followerInfoCache.get(userId);
    if (cachedData) {
      return Response.json(cachedData);
    }

    const [user, isFollowing] = await Promise.all([
      prisma.user.findUnique({
        select: {
          _count: {
            select: { followers: true },
          },
        },
        where: { id: userId },
      }),
      loggedInUser
        ? prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: loggedInUser.id,
                followingId: userId,
              },
            },
          })
        : Promise.resolve(null),
    ]);

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const data: FollowerInfo = {
      followers: user._count.followers,
      isFollowedByUser: Boolean(loggedInUser && isFollowing),
    };

    await followerInfoCache.set(userId, data);

    return Response.json(data);
  } catch (error) {
    console.error("GET follower info error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ userId: string }> }
) {
  const params = await props.params;
  const { userId } = params;

  try {
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;

    if (!loggedInUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingFollow = await tx.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: loggedInUser.id,
            followingId: userId,
          },
        },
      });

      if (existingFollow) {
        await tx.follow.delete({
          where: {
            followerId_followingId: {
              followerId: loggedInUser.id,
              followingId: userId,
            },
          },
        });

        await tx.notification.deleteMany({
          where: {
            issuerId: loggedInUser.id,
            recipientId: userId,
            type: "FOLLOW",
          },
        });

        enqueueNotificationDeleted(userId).catch((error: unknown) => {
          console.error(
            "Failed to enqueue unfollow notification event:",
            error
          );
        });

        await tx.user.update({
          data: { aura: { decrement: FOLLOW_AURA_REWARD } },
          where: { id: userId },
        });

        await tx.auraLog.create({
          data: {
            amount: -FOLLOW_AURA_REWARD,
            issuerId: loggedInUser.id,
            type: "FOLLOW_GAINED",
            userId,
          },
        });

        // Reverse the follower aura only if it was ever granted (follows
        // created before FOLLOW_GIVEN shipped never earned it).
        const givenLog = await tx.auraLog.findFirst({
          where: { type: "FOLLOW_GIVEN", userId: loggedInUser.id },
        });

        if (givenLog) {
          await tx.user.update({
            data: { aura: { decrement: FOLLOW_GIVEN_AURA_REWARD } },
            where: { id: loggedInUser.id },
          });

          await tx.auraLog.create({
            data: {
              amount: -FOLLOW_GIVEN_AURA_REWARD,
              issuerId: loggedInUser.id,
              type: "FOLLOW_GIVEN",
              userId: loggedInUser.id,
            },
          });
        }
      }

      const userData = await tx.user.findUnique({
        select: {
          _count: { select: { followers: true } },
          displayName: true,
          username: true,
        },
        where: { id: userId },
      });

      return userData;
    });

    if (!result) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const followerInfo: FollowerInfo & {
      displayName: string;
      username: string;
    } = {
      displayName: result.displayName,
      followers: result._count.followers,
      isFollowedByUser: false,
      username: result.username,
    };

    await Promise.all([
      followerInfoCache.invalidate(userId),
      suggestedUsersCache.invalidateForUser(userId),
    ]);

    return Response.json(followerInfo);
  } catch (error) {
    console.error("Unfollow error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
