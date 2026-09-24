import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;
    if (!loggedInUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await ctx.params;

    const followers = await prisma.orm.public.Users.select(
      "avatarUrl",
      "bio",
      "displayName",
      "id",
      "username"
    )
      .where((user) =>
        user.follows.some((follow) => follow.followingId.eq(userId))
      )
      .all();
    const followerIds = followers.map((follower) => follower.id);
    const [followerRows, followingStatus] = await Promise.all([
      prisma.orm.public.Follows.select("followingId")
        .where((follow) => follow.followingId.in(followerIds))
        .all(),
      prisma.orm.public.Follows.select("followingId")
        .where((follow) =>
          and(
            follow.followerId.eq(loggedInUser.id),
            follow.followingId.in(followerIds)
          )
        )
        .all(),
    ]);
    const followerCounts = new Map<string, number>();
    for (const follow of followerRows) {
      followerCounts.set(
        follow.followingId,
        (followerCounts.get(follow.followingId) ?? 0) + 1
      );
    }

    const followingSet = new Set(followingStatus.map((f) => f.followingId));

    const followersWithStatus = followers.map((user) => ({
      ...user,
      _count: { followers: followerCounts.get(user.id) ?? 0 },
      isFollowing: followingSet.has(user.id),
    }));

    return Response.json(followersWithStatus);
  } catch (error) {
    console.error("Error fetching followers list:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
