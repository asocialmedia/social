// Community aura projections. The sidebar's aura numbers are read far more
// often than they change, so the aggregate is cached in Redis with a short TTL
// and invalidated eagerly when a post is created or removed. The underlying
// computation lives in service.getCommunityStats; this module only wraps it.

import { createLogger } from "@asm/logger";

import { redis } from "../redis";
import { getCommunityStats } from "./service";
import type { CommunityStats } from "./service";

const logger = createLogger({ serviceName: "community-aura" });

const STATS_CACHE_PREFIX = "community:stats:";
const STATS_CACHE_TTL_SECONDS = 60;

function statsKey(communityId: string): string {
  return `${STATS_CACHE_PREFIX}${communityId}`;
}

export async function getCachedCommunityStats(
  communityId: string
): Promise<CommunityStats> {
  try {
    const cached = await redis.get(statsKey(communityId));
    if (cached) {
      return JSON.parse(cached) as CommunityStats;
    }
  } catch (error) {
    logger.warn(
      { communityId, error: String(error) },
      "community stats cache read failed"
    );
  }

  const stats = await getCommunityStats(communityId);

  try {
    await redis.set(
      statsKey(communityId),
      JSON.stringify(stats),
      "EX",
      STATS_CACHE_TTL_SECONDS
    );
  } catch (error) {
    logger.warn(
      { communityId, error: String(error) },
      "community stats cache write failed"
    );
  }

  return stats;
}

export async function invalidateCommunityStats(
  communityId: string
): Promise<void> {
  try {
    await redis.del(statsKey(communityId));
  } catch (error) {
    logger.warn(
      { communityId, error: String(error) },
      "community stats cache invalidate failed"
    );
  }
}
