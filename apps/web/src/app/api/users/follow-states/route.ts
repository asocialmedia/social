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

    if (userIds.length === 0) {
      return Response.json({});
    }

    const [follows, followerCountRows] = await Promise.all([
      prisma.orm.public.Follows.select("followingId")
        .where((follow) =>
          and(
            follow.followerId.eq(loggedInUser.id),
            follow.followingId.in(userIds)
          )
        )
        .all(),
      prisma.orm.public.Follows.where((follow) =>
        follow.followingId.in(userIds)
      )
        .groupBy("followingId")
        .aggregate((aggregate) => ({ count: aggregate.count() })),
    ]);

    const followerCounts = new Map(
      followerCountRows.map((row) => [row.followingId, row.count])
    );

    const followedUserIds = new Set(
      follows.map((follow) => follow.followingId)
    );
    const followStates = new Map<string, FollowState>();
    for (const userId of userIds) {
      followStates.set(userId, {
        followers: followerCounts.get(userId) ?? 0,
        isFollowedByUser: followedUserIds.has(userId),
      });
    }

    return Response.json(Object.fromEntries(followStates));
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
