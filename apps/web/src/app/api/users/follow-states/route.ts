import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;
    if (!loggedInUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userIds } = await req.json();

    const follows = await prisma.follow.findMany({
      where: {
        followerId: loggedInUser.id,
        followingId: { in: userIds },
      },
    });

    const followers = await prisma.user.findMany({
      select: {
        _count: { select: { followers: true } },
        id: true,
      },
      where: { id: { in: userIds } },
    });

    const followStates: Record<
      string,
      { followers: number; isFollowedByUser: boolean }
    > = {};

    for (const user of followers) {
      followStates[user.id] = {
        followers: user._count.followers,
        isFollowedByUser: follows.some((f) => f.followingId === user.id),
      };
    }

    return Response.json(followStates);
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
