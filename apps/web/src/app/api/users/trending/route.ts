import {
  getUserDataSelect,
  prisma,
  redis,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

const TRENDING_USERS_CACHE_KEY = "trending:users:global";
const TRENDING_USERS_TTL = 60;

export async function GET() {
  try {
    const session = await getSessionFromApi();
    const userId = session?.user?.id;

    // For unauthenticated requests, check the Redis cache first
    if (!userId) {
      try {
        const cached = await redis.get(TRENDING_USERS_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { id: string }[];
          // The cache may predate the system-user exclusion, so filter it out
          // before serving.
          const visible = parsed.filter(
            (u) => u.id !== SYSTEM_MODERATION_USER_ID
          );
          return Response.json(visible, {
            headers: {
              "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
              vary: "Cookie",
            },
          });
        }
      } catch {
        // Cache miss or error: fall through to DB query
      }
    }

    const trendingUsers = await prisma.user.findMany({
      orderBy: [
        {
          followers: {
            _count: "desc",
          },
        },
        {
          aura: "desc",
        },
      ],
      select: getUserDataSelect(userId || ""),
      take: 6,
      where: {
        AND: [
          { id: { not: userId || undefined } },
          { id: { not: SYSTEM_MODERATION_USER_ID } },
        ],
      },
    });

    // Populate the guest cache
    if (!userId && trendingUsers.length > 0) {
      try {
        await redis.setex(
          TRENDING_USERS_CACHE_KEY,
          TRENDING_USERS_TTL,
          JSON.stringify(trendingUsers)
        );
      } catch {
        // Non-fatal
      }
      return Response.json(trendingUsers, {
        headers: {
          "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
          vary: "Cookie",
        },
      });
    }

    const responseHeaders = userId
      ? { "cache-control": "private, no-cache", vary: "Cookie" }
      : {
          "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
          vary: "Cookie",
        };

    return Response.json(trendingUsers, { headers: responseHeaders });
  } catch {
    return Response.json(
      { error: "Failed to fetch trending users" },
      { status: 500 }
    );
  }
}
