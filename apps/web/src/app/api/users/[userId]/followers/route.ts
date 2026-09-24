import { debugLog } from "@asm/config/debug";
import {
  and,
  applyFlatAward,
  applyWeightedAward,
  FOLLOW_GAINED_AURA,
  FOLLOW_GIVEN_AURA,
  fromPrismaDateTime,
  followerInfoCache,
  invalidateAuraSignals,
  invalidateFypProfile,
  prisma,
  reverseExactAura,
} from "@asm/db";
import type { FollowerInfo } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  flushNotificationEvents,
  newNotificationEvents,
} from "@/lib/notifications/deferred-events";
import { suggestedUsersCache } from "@/lib/users/suggested-users-cache";

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

    // Self-follows would inflate aura and the follower count with no social
    // meaning; the bookmark route applies the same anti-farming rule.
    if (userId === loggedInUser.id) {
      return Response.json(
        { error: "You cannot follow yourself" },
        { status: 400 }
      );
    }

    const notificationEvents = newNotificationEvents();
    const result = await prisma.transaction(async (tx) => {
      // Only reward aura when the follow is actually created, so repeated
      // follow calls (double-clicks, retries) cannot farm aura.
      const existingFollow = await tx.orm.public.Follows.where((follow) =>
        and(
          follow.followerId.eq(loggedInUser.id),
          follow.followingId.eq(userId)
        )
      ).first();

      if (!existingFollow) {
        const followNotification = await tx.orm.public.Notifications.select(
          "id"
        ).create({
          _type: "FOLLOW",
          issuerId: loggedInUser.id,
          recipientId: userId,
        });

        notificationEvents.created.push({
          notificationId: followNotification.id,
          recipientId: userId,
        });

        // Gaining a follower is weighted by the FOLLOWER's credibility: a
        // veteran's follow means more than a throwaway's, and follow rings
        // taper per pair like every engagement class.
        let gainedAmount = 0;
        const follower = await tx.orm.public.Users.select("aura", "createdAt")
          .where({ id: loggedInUser.id })
          .first();
        if (follower) {
          const awarded = await applyWeightedAward(tx, {
            actor: {
              aura: follower.aura,
              createdAt: fromPrismaDateTime(follower.createdAt),
            },
            actorId: loggedInUser.id,
            baseAmount: FOLLOW_GAINED_AURA,
            now: new Date(),
            recipientId: userId,
            subjectToDailyCap: true,
            taperClass: "follow",
            type: "FOLLOW_GAINED",
          });
          gainedAmount = awarded.amount;
        }

        // Network-building credit for the follower themselves: flat stipend
        // under their own daily cap, so mass-following churn is bounded.
        const { amount: givenAmount } = await applyFlatAward(tx, {
          actorId: loggedInUser.id,
          baseAmount: FOLLOW_GIVEN_AURA,
          now: new Date(),
          recipientId: loggedInUser.id,
          subjectToDailyCap: true,
          type: "FOLLOW_GIVEN",
        });

        await tx.orm.public.Follows.create({
          followerId: loggedInUser.id,
          followingId: userId,
          gainedAura: gainedAmount,
          givenAura: givenAmount,
        });
      }

      const [userData, followerCount] = await Promise.all([
        tx.orm.public.Users.select("displayName", "id", "username")
          .where({ id: userId })
          .first(),
        tx.orm.public.Follows.where((follow) =>
          follow.followingId.eq(userId)
        ).aggregate((aggregate) => ({ count: aggregate.count() })),
      ]);

      return {
        userData: userData
          ? { ...userData, _count: { followers: followerCount.count } }
          : null,
      };
    });

    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "follow");

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
    void invalidateFypProfile(loggedInUser.id);
    // Who to follow is personalized for the actor; following someone
    // invalidates their suggestions so the just-followed user disappears
    // and a fresh candidate can surface without waiting for TTL.
    await suggestedUsersCache.invalidate(loggedInUser.id).catch(() => {
      /* empty */
    });
    try {
      await invalidateAuraSignals([params.userId, loggedInUser.id]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
    }

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

    const [user, followerCount, isFollowing] = await Promise.all([
      prisma.orm.public.Users.select("id").where({ id: userId }).first(),
      prisma.orm.public.Follows.where((follow) =>
        follow.followingId.eq(userId)
      ).aggregate((aggregate) => ({ count: aggregate.count() })),
      loggedInUser
        ? prisma.orm.public.Follows.select("followerId")
            .where((follow) =>
              and(
                follow.followerId.eq(loggedInUser.id),
                follow.followingId.eq(userId)
              )
            )
            .first()
        : Promise.resolve(null),
    ]);

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const data: FollowerInfo = {
      followers: followerCount.count,
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

    // Mirror of the follow guard: a self-unfollow is equally meaningless.
    if (userId === loggedInUser.id) {
      return Response.json(
        { error: "You cannot unfollow yourself" },
        { status: 400 }
      );
    }

    const notificationEvents = newNotificationEvents();
    const result = await prisma.transaction(async (tx) => {
      // Read the stored open positions before deleting: unfollowing reverses
      // exactly what this follow awarded. Legacy follows carry zeros and
      // reverse nothing - conservative under-refund by design.
      const existingFollow = await tx.orm.public.Follows.where((follow) =>
        and(
          follow.followerId.eq(loggedInUser.id),
          follow.followingId.eq(userId)
        )
      ).first();

      if (existingFollow) {
        await tx.orm.public.Follows.where((follow) =>
          and(
            follow.followerId.eq(loggedInUser.id),
            follow.followingId.eq(userId)
          )
        ).delete();

        await tx.orm.public.Notifications.where((notification) =>
          and(
            notification.issuerId.eq(loggedInUser.id),
            notification.recipientId.eq(userId),
            notification._type.eq("FOLLOW")
          )
        ).delete();

        notificationEvents.deleted.push(userId);

        if (existingFollow.gainedAura !== 0) {
          await reverseExactAura(tx, {
            issuerId: loggedInUser.id,
            openAmount: existingFollow.gainedAura,
            recipientId: userId,
            targetUserId: userId,
            type: "FOLLOW_GAINED",
          });
        }

        if (existingFollow.givenAura !== 0) {
          await reverseExactAura(tx, {
            issuerId: loggedInUser.id,
            openAmount: existingFollow.givenAura,
            recipientId: loggedInUser.id,
            targetUserId: loggedInUser.id,
            type: "FOLLOW_GIVEN",
          });
        }
      }

      const [userData, followerCount] = await Promise.all([
        tx.orm.public.Users.select("displayName", "id", "username")
          .where({ id: userId })
          .first(),
        tx.orm.public.Follows.where((follow) =>
          follow.followingId.eq(userId)
        ).aggregate((aggregate) => ({ count: aggregate.count() })),
      ]);

      return userData
        ? { ...userData, _count: { followers: followerCount.count } }
        : null;
    });

    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "follow");

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
      suggestedUsersCache.invalidate(loggedInUser.id).catch(() => {
        /* empty */
      }),
    ]);
    void invalidateFypProfile(loggedInUser.id);
    try {
      await invalidateAuraSignals([userId, loggedInUser.id]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
    }

    return Response.json(followerInfo);
  } catch (error) {
    console.error("Unfollow error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
