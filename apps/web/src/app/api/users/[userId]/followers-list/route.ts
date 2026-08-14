import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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

    const followers = await prisma.user.findMany({
      select: {
        _count: {
          select: {
            followers: true,
          },
        },
        avatarUrl: true,
        bio: true,
        displayName: true,
        id: true,
        username: true,
      },
      where: {
        following: {
          some: {
            followingId: userId,
          },
        },
      },
    });

    const followingStatus = await prisma.follow.findMany({
      where: {
        followerId: loggedInUser.id,
        followingId: {
          in: followers.map((user) => user.id),
        },
      },
    });

    const followingSet = new Set(followingStatus.map((f) => f.followingId));

    const followersWithStatus = followers.map((user) => ({
      ...user,
      isFollowing: followingSet.has(user.id),
    }));

    return Response.json(followersWithStatus);
  } catch (error) {
    console.error("Error fetching followers list:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
