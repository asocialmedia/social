// Community projections. The sidebar's aura numbers and the discovery
// category counts are read far more often than they change, so each aggregate
// is cached in Redis with a short TTL. The stats cache is also invalidated
// eagerly when a post is created or removed; the counts cache just rides its
// TTL because a newly founded community reaching the filter row a minute late
// is invisible to the reader. The underlying computations live in
// service.getCommunityStats / service.getCommunityCategoryCounts; this module
// only wraps them.

import { createLogger } from "@asm/logger";

import { redis } from "../redis";
import {
  getCommunityCategoryCounts,
  getCommunityDiscoveryStats,
  getCommunitySections,
  getCommunityStats,
  getMostActiveCategory,
  getTopCommunities,
  getTopCommunitiesByAura,
} from "./service";
import type {
  ActiveCategory,
  CommunityData,
  CommunityDiscoveryStats,
  CommunitySections,
  CommunityStats,
} from "./service";

const logger = createLogger({ serviceName: "community-aura" });

const STATS_CACHE_PREFIX = "community:stats:";
const STATS_CACHE_TTL_SECONDS = 60;
const CATEGORY_COUNTS_CACHE_KEY = "community:category-counts";
const CATEGORY_COUNTS_TTL_SECONDS = 60;
const DISCOVERY_STATS_CACHE_KEY = "community:discovery-stats";
const DISCOVERY_STATS_TTL_SECONDS = 60;
const SECTIONS_CACHE_KEY = "community:sections";
const SECTIONS_TTL_SECONDS = 60;

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

// Category counts for the discovery filter row, cached as one small map.
export async function getCachedCommunityCategoryCounts(): Promise<
  Record<string, number>
> {
  try {
    const cached = await redis.get(CATEGORY_COUNTS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as Record<string, number>;
    }
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "community category counts cache read failed"
    );
  }

  const counts = await getCommunityCategoryCounts();

  try {
    await redis.set(
      CATEGORY_COUNTS_CACHE_KEY,
      JSON.stringify(counts),
      "EX",
      CATEGORY_COUNTS_TTL_SECONDS
    );
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "community category counts cache write failed"
    );
  }

  return counts;
}

// Headline totals for the discovery hero, cached on the same short TTL.
export async function getCachedCommunityDiscoveryStats(): Promise<CommunityDiscoveryStats> {
  try {
    const cached = await redis.get(DISCOVERY_STATS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as CommunityDiscoveryStats;
    }
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "community discovery stats cache read failed"
    );
  }

  const stats = await getCommunityDiscoveryStats();

  try {
    await redis.set(
      DISCOVERY_STATS_CACHE_KEY,
      JSON.stringify(stats),
      "EX",
      DISCOVERY_STATS_TTL_SECONDS
    );
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "community discovery stats cache write failed"
    );
  }

  return stats;
}

// Curated discovery rails, cached as one payload on the same short TTL.
export async function getCachedCommunitySections(): Promise<CommunitySections> {
  try {
    const cached = await redis.get(SECTIONS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as CommunitySections;
    }
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "community sections cache read failed"
    );
  }

  const sections = await getCommunitySections();

  try {
    await redis.set(
      SECTIONS_CACHE_KEY,
      JSON.stringify(sections),
      "EX",
      SECTIONS_TTL_SECONDS
    );
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "community sections cache write failed"
    );
  }

  return sections;
}

// Sidebar leaderboards: highest-aura communities and the most active category.
// Both are global rankings that move slowly, so they share the same short TTL.
export async function getCachedTopCommunitiesByAura(): Promise<
  CommunityData[]
> {
  const KEY = "community:top-by-aura";
  try {
    const cached = await redis.get(KEY);
    if (cached) {
      return JSON.parse(cached) as CommunityData[];
    }
  } catch (error) {
    logger.warn({ error: String(error) }, "top communities cache read failed");
  }

  const communities = await getTopCommunitiesByAura();

  try {
    await redis.set(
      KEY,
      JSON.stringify(communities),
      "EX",
      SECTIONS_TTL_SECONDS
    );
  } catch (error) {
    logger.warn({ error: String(error) }, "top communities cache write failed");
  }

  return communities;
}

export async function getCachedMostActiveCategory(): Promise<ActiveCategory | null> {
  const KEY = "community:most-active-category";
  try {
    const cached = await redis.get(KEY);
    if (cached) {
      return JSON.parse(cached) as ActiveCategory;
    }
  } catch (error) {
    logger.warn({ error: String(error) }, "active category cache read failed");
  }

  const category = await getMostActiveCategory();

  try {
    // Null is a real answer ("no posts yet"); cache it as JSON `null` so the
    // empty state does not re-query on every request.
    await redis.set(KEY, JSON.stringify(category), "EX", SECTIONS_TTL_SECONDS);
  } catch (error) {
    logger.warn({ error: String(error) }, "active category cache write failed");
  }

  return category;
}

// Sidebar "Popular communities": a global population ranking, cached on the
// same short TTL as the other leaderboards.
export async function getCachedTopCommunities(): Promise<CommunityData[]> {
  const KEY = "community:top-by-population";
  try {
    const cached = await redis.get(KEY);
    if (cached) {
      return JSON.parse(cached) as CommunityData[];
    }
  } catch (error) {
    logger.warn({ error: String(error) }, "top communities cache read failed");
  }

  const communities = await getTopCommunities();

  try {
    await redis.set(
      KEY,
      JSON.stringify(communities),
      "EX",
      SECTIONS_TTL_SECONDS
    );
  } catch (error) {
    logger.warn({ error: String(error) }, "top communities cache write failed");
  }

  return communities;
}
