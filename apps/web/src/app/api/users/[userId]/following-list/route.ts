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

    const following = await prisma.orm.public.Users.select(
      "avatarUrl",
      "bio",
      "displayName",
      "id",
      "username"
    )
      .where((user) =>
        user.followsFollows.some((follow) => follow.followerId.eq(userId))
      )
      .all();
    const followingIds = following.map((user) => user.id);
    const [followerRows, followingStatus] = await Promise.all([
      prisma.orm.public.Follows.select("followingId")
        .where((follow) => follow.followingId.in(followingIds))
        .all(),
      prisma.orm.public.Follows.select("followingId")
        .where((follow) =>
          and(
            follow.followerId.eq(loggedInUser.id),
            follow.followingId.in(followingIds)
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

    const followingWithStatus = following.map((user) => ({
      ...user,
      _count: { followers: followerCounts.get(user.id) ?? 0 },
      isFollowing: followingSet.has(user.id),
    }));

    return Response.json(followingWithStatus);
  } catch (error) {
    console.error("Error fetching following list:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
