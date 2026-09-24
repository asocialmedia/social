import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function POST(req: Request) {
  try {
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;
    if (!loggedInUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userIds } = await req.json();

    const follows = await prisma.orm.public.Follows.select("followingId")
      .where((follow) =>
        and(
          follow.followerId.eq(loggedInUser.id),
          follow.followingId.in(userIds)
        )
      )
      .all();

    const followerRows = await prisma.orm.public.Follows.select("followingId")
      .where((follow) => follow.followingId.in(userIds))
      .all();

    const followerCounts: Record<string, number> = {};
    for (const follow of followerRows) {
      followerCounts[follow.followingId] =
        (followerCounts[follow.followingId] ?? 0) + 1;
    }

    const followStates: Record<
      string,
      { followers: number; isFollowedByUser: boolean }
    > = {};

    for (const userId of userIds) {
      followStates[userId] = {
        followers: followerCounts[userId] ?? 0,
        isFollowedByUser: follows.some(
          (follow) => follow.followingId === userId
        ),
      };
    }

    return Response.json(followStates);
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
