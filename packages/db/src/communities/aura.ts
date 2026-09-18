// Community projections. The sidebar's aura numbers and the discovery
// category counts are read far more often than they change, so each aggregate
// is cached in Redis with a short TTL. The stats cache is also invalidated
// eagerly when a post is created or removed; the counts cache just rides its
// TTL because a newly founded community reaching the filter row a minute late
// is invisible to the reader. The underlying computations live in
// service.getCommunityStats / service.getCommunityCategoryCounts; this module
// only wraps them.
//
// Every aggregate goes through `withAggregateCache`, which adds two protections
// the plain get/set pattern lacked:
//   1. Single-flight. When a key expires under load, only one caller
//      recomputes and the rest wait briefly for it instead of stampeding the
//      database with the same expensive aggregate. (A stale copy is served if
//      the leader is slower than the wait.)
//   2. Stale-while-error. The last good value is kept on a longer TTL as a
//      fallback, so a database hiccup degrades the numbers to slightly old
//      rather than blanking the page.

import { createLogger } from "@asm/logger";

import { claimOnce, redis } from "../redis";
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
const CATEGORY_COUNTS_TTL_SECONDS = 120;
const DISCOVERY_STATS_CACHE_KEY = "community:discovery-stats";
const DISCOVERY_STATS_TTL_SECONDS = 120;
const SECTIONS_CACHE_KEY = "community:sections";
const SECTIONS_TTL_SECONDS = 300;
// Leaderboards move slowly by nature (a rank flips only when two communities
// cross), so they sit on a much longer TTL than the live-ish counts.
const LEADERBOARD_TTL_SECONDS = 300;
// How many multiples of the primary TTL the stale fallback is kept for.
const STALE_TTL_MULTIPLIER = 10;

function statsKey(communityId: string): string {
  return `${STATS_CACHE_PREFIX}${communityId}`;
}

interface CacheRead<T> {
  hit: boolean;
  value: T;
}

async function readCached<T>(key: string): Promise<CacheRead<T>> {
  try {
    const raw = await redis.get(key);
    if (raw === null) {
      return { hit: false, value: undefined as T };
    }
    return { hit: true, value: JSON.parse(raw) as T };
  } catch (error) {
    logger.warn({ error: String(error), key }, "community cache read failed");
    return { hit: false, value: undefined as T };
  }
}

async function writeCached(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    logger.warn({ error: String(error), key }, "community cache write failed");
  }
}

// A monotonic per-key generation, bumped on every invalidation. It exists to
// close the compute/invalidate race: a read miss starts a compute, a writer
// invalidates mid-flight, and the compute then writes its now-stale result back
// over the fresh state - exactly the stale-count bug the eager invalidation was
// meant to fix. The generation is captured before compute and re-checked before
// writing, so a computation that spans an invalidation is discarded.
function generationKey(key: string): string {
  return `${key}:gen`;
}

async function readGeneration(key: string): Promise<string | null> {
  try {
    return await redis.get(generationKey(key));
  } catch (error) {
    // Fail open: without a readable generation the guard is a no-op and the
    // cache behaves as it did before (stale-while-invalidate is possible but
    // Redis is already down, so every read misses anyway).
    logger.warn(
      { error: String(error), key },
      "community cache generation read failed"
    );
    return null;
  }
}

async function bumpGeneration(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => redis.incr(generationKey(key))));
}

// Read-through cache with single-flight and a stale fallback. Fails open: if
// Redis is unreachable every call recomputes, exactly as the previous
// uncached-on-error behaviour did.
async function withAggregateCache<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<T> {
  const primary = await readCached<T>(key);
  if (primary.hit) {
    return primary.value;
  }

  const staleKey = `${key}:stale`;
  const hasLock = await claimOnce(
    `${key}:lock`,
    Math.max(5, Math.ceil(ttlSeconds / 2))
  );
  if (!hasLock) {
    // Another caller is already recomputing. Serve the last good copy instead
    // of piling a second heavy aggregate onto the database. On a truly cold
    // key there is no stale copy, so fall through and compute rather than
    // return nothing; only the first load of a key can duplicate work.
    const stale = await readCached<T>(staleKey);
    if (stale.hit) {
      return stale.value;
    }
  }

  const generationBefore = await readGeneration(key);
  const value = await compute();
  const generationAfter = await readGeneration(key);

  // Only cache the result if no invalidation happened while it was computing.
  // On a null guard (Redis unreachable) both reads are null and match, so the
  // write proceeds - the pre-guard behaviour.
  if (generationBefore === generationAfter) {
    await writeCached(key, value, ttlSeconds);
    await writeCached(staleKey, value, ttlSeconds * STALE_TTL_MULTIPLIER);
  } else {
    logger.info(
      { key },
      "community aggregate invalidated mid-compute; skipping cache write"
    );
  }

  return value;
}

export function getCachedCommunityStats(
  communityId: string
): Promise<CommunityStats> {
  return withAggregateCache(
    statsKey(communityId),
    STATS_CACHE_TTL_SECONDS,
    () => getCommunityStats(communityId)
  );
}

export async function invalidateCommunityStats(
  communityId: string
): Promise<void> {
  const key = statsKey(communityId);
  try {
    // Bump the generation FIRST so any compute already in flight for this key
    // observes the change and skips its write, then drop the stored copies.
    await bumpGeneration([key]);
    await redis.del(key, `${key}:stale`);
  } catch (error) {
    logger.warn(
      { communityId, error: String(error) },
      "community stats cache invalidate failed"
    );
  }
}

// Best-effort multi-key drop for one aggregate: the primary entry and its
// longer-lived stale fallback. A missing key is a no-op; a Redis outage only
// means the stale copy survives to its TTL.
async function invalidateKeys(keys: string[]): Promise<void> {
  const targets = keys.flatMap((key) => [key, `${key}:stale`]);
  try {
    // Generations are bumped before the delete so a concurrent compute cannot
    // repopulate either copy with a value that predates this invalidation.
    await bumpGeneration(keys);
    await redis.del(...targets);
  } catch (error) {
    logger.warn(
      { error: String(error), keys },
      "community aggregate cache invalidate failed"
    );
  }
}

// Founding a community changes every population-derived aggregate: the hero's
// community total, the category filter counts, and both the curated rails and
// the sidebar rankings.
export function invalidateCommunityCreationAggregates(): Promise<void> {
  return invalidateKeys([
    CATEGORY_COUNTS_CACHE_KEY,
    DISCOVERY_STATS_CACHE_KEY,
    SECTIONS_CACHE_KEY,
    "community:top-by-aura",
    "community:top-by-population",
    "community:most-active-category",
  ]);
}

// A post being published or deleted moves the hero's post total and the
// highest-aura community ranking, on top of the community's own stats (dropped
// separately by id). Without this the discovery totals and the "Top by aura"
// sidebar list stay stale until their TTL.
export function invalidateCommunityPostAggregates(): Promise<void> {
  return invalidateKeys([DISCOVERY_STATS_CACHE_KEY, "community:top-by-aura"]);
}

// A join/leave/approve changes population, which reorders the rails, the
// sidebar's popularity ranking, and the most-active category. The per-community
// stats are dropped separately (they are keyed by id).
export function invalidateCommunityPopulationAggregates(): Promise<void> {
  return invalidateKeys([
    DISCOVERY_STATS_CACHE_KEY,
    SECTIONS_CACHE_KEY,
    "community:top-by-population",
    "community:most-active-category",
  ]);
}

// Category counts for the discovery filter row, cached as one small map.
export function getCachedCommunityCategoryCounts(): Promise<
  Record<string, number>
> {
  return withAggregateCache(
    CATEGORY_COUNTS_CACHE_KEY,
    CATEGORY_COUNTS_TTL_SECONDS,
    getCommunityCategoryCounts
  );
}

// Headline totals for the discovery hero, cached on a slightly longer TTL.
export function getCachedCommunityDiscoveryStats(): Promise<CommunityDiscoveryStats> {
  return withAggregateCache(
    DISCOVERY_STATS_CACHE_KEY,
    DISCOVERY_STATS_TTL_SECONDS,
    getCommunityDiscoveryStats
  );
}

// Curated discovery rails, cached as one payload.
export function getCachedCommunitySections(): Promise<CommunitySections> {
  return withAggregateCache(
    SECTIONS_CACHE_KEY,
    SECTIONS_TTL_SECONDS,
    getCommunitySections
  );
}

// Sidebar leaderboards: highest-aura communities and the most active category.
// Both are global rankings that move slowly, so they share one longer TTL.
export function getCachedTopCommunitiesByAura(): Promise<CommunityData[]> {
  return withAggregateCache(
    "community:top-by-aura",
    LEADERBOARD_TTL_SECONDS,
    () => getTopCommunitiesByAura()
  );
}

export function getCachedMostActiveCategory(): Promise<ActiveCategory | null> {
  return withAggregateCache(
    "community:most-active-category",
    LEADERBOARD_TTL_SECONDS,
    getMostActiveCategory
  );
}

// Sidebar "Popular communities": a global population ranking.
export function getCachedTopCommunities(): Promise<CommunityData[]> {
  return withAggregateCache(
    "community:top-by-population",
    LEADERBOARD_TTL_SECONDS,
    () => getTopCommunities()
  );
}
