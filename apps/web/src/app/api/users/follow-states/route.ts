import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

const MAX_FOLLOW_STATE_USER_IDS = 100;
const MAX_FOLLOW_STATE_USER_ID_LENGTH = 128;

interface FollowState {
  followers: number;
  isFollowedByUser: boolean;
}

function getFollowStateUserIds(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const { userIds } = payload as { userIds?: unknown };
  if (!Array.isArray(userIds) || userIds.length > MAX_FOLLOW_STATE_USER_IDS) {
    return null;
  }

  const normalizedUserIds: string[] = [];
  for (const userId of userIds) {
    if (
      typeof userId !== "string" ||
      userId.length === 0 ||
      userId.length > MAX_FOLLOW_STATE_USER_ID_LENGTH
    ) {
      return null;
    }
    normalizedUserIds.push(userId);
  }

  return [...new Set(normalizedUserIds)];
}

export async function POST(req: Request) {
  try {
    const session = await getSessionFromApi();
    const loggedInUser = session?.user;
    if (!loggedInUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload: unknown = await req.json();
    const userIds = getFollowStateUserIds(payload);
    if (!userIds) {
      return Response.json({ error: "Invalid userIds" }, { status: 400 });
    }

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

    const followedUserIds = new Set(
      follows.map((follow) => follow.followingId)
    );
    const followStates = new Map<string, FollowState>();
    for (const userId of userIds) {
      followStates.set(userId, {
        followers: followerCounts[userId] ?? 0,
        isFollowedByUser: followedUserIds.has(userId),
      });
    }

    return Response.json(Object.fromEntries(followStates));
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
