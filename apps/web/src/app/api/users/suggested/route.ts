import { setTimeout as delay } from "node:timers/promises";

import {
  consumeRateLimit,
  getClientIpFromRequest,
  getUserDataSelect,
  prisma,
  redis,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/session";
import { suggestedUsersCache } from "@/lib/suggested-users-cache";
import {
  buildViewerInterests,
  diversifyRanked,
  rankCandidates,
} from "@/lib/suggested-users-scoring";
import type { SuggestionCandidate } from "@/lib/suggested-users-scoring";

export type { UserData } from "@asm/db";

const logger = createLogger({ serviceName: "api-suggested-users" });

const RECENTLY_SHOWN_CACHE_KEY = (userId: string) =>
  `recently-shown-users:${userId}`;
const RECENTLY_SHOWN_TTL = 3600;
const SUGGESTED_LOCK_KEY = (userId: string) => `suggested-users:lock:${userId}`;
const SUGGESTED_LOCK_TTL = 10;
const CACHE_STALE_MS = 4 * 60 * 1000; // Serve stale and refresh in background if older than 4 min (TTL is 5 min)

function parseLimit(req: Request): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("limit");
    if (!raw) {
      return 6;
    }
    const parsed = Math.trunc(Number(raw));
    if (Number.isNaN(parsed) || parsed <= 0) {
      return 6;
    }
    return Math.min(parsed, 12);
  } catch {
    return 6;
  }
}

function isRefreshRequest(req: Request): boolean {
  try {
    return new URL(req.url).searchParams.get("refresh") === "1";
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    const limit = parseLimit(req);
    const isRefresh = isRefreshRequest(req);

    // --- Rate limiting (both per-user and per-IP for guests/heavy traffic) ---
    const ip = getClientIpFromRequest(req);
    const rateLimitId = user ? `user:${user.id}` : `ip:${ip}`;
    const rateLimit = isRefresh ? 5 : 30;
    const rate = await consumeRateLimit({
      bucket: "suggested-users",
      identifier: rateLimitId,
      limit: rateLimit,
      windowSeconds: 60,
    });
    if (!rate.allowed) {
      logger.warn(
        { ip, isRefresh, rate, userId: user?.id },
        "suggested users rate limited"
      );
      return Response.json(
        { error: "Too many requests, slow down" },
        {
          headers: {
            "Retry-After": String(rate.retryAfterSeconds),
            "X-RateLimit-Remaining": String(rate.remaining),
          },
          status: 429,
        }
      );
    }

    if (!user) {
      const guestUsers = await prisma.user.findMany({
        orderBy: { aura: "desc" },
        select: { ...getUserDataSelect(""), aura: true },
        take: limit,
        where: { banned: false, id: { not: SYSTEM_MODERATION_USER_ID } },
      });
      logger.info(
        { count: guestUsers.length, ip, limit, ms: Date.now() - startedAt },
        "guest suggestions served"
      );
      return Response.json(guestUsers, {
        headers: { "Cache-Control": "public, max-age=60", "X-Cache": "N/A" },
      });
    }

    // Refresh bypasses cache but still respects rate limit
    // --- Cache with stale-while-revalidate ---
    let cached: unknown = null;
    let cacheAgeMs: number | null = null;
    let rawCached: string | null = null;
    if (!isRefresh) {
      rawCached = await redis.get(`suggested-users:v2:${user.id}`);
      if (rawCached) {
        try {
          const parsed = JSON.parse(rawCached) as {
            _cachedAt?: number;
            _data?: unknown;
          };
          // New cache shape wraps with _cachedAt, old shape is direct array
          if (Array.isArray(parsed)) {
            cached = parsed;
          } else if (
            parsed &&
            typeof parsed === "object" &&
            "_data" in parsed
          ) {
            cached = (parsed as { _data: unknown })._data;
            cacheAgeMs =
              Date.now() - ((parsed as { _cachedAt: number })._cachedAt ?? 0);
          } else {
            cached = parsed;
          }
        } catch {
          cached = null;
        }
      }

      if (cached) {
        const visible = (cached as { id: string }[]).filter(
          (c) => c.id !== SYSTEM_MODERATION_USER_ID
        );
        // Filter out users the viewer has since followed (stale cache)
        const cachedIds = visible.map((c) => c.id);
        if (cachedIds.length > 0) {
          const stillNotFollowing = await prisma.follow.findMany({
            select: { followingId: true },
            where: { followerId: user.id, followingId: { in: cachedIds } },
          });
          const followedSet = new Set(
            stillNotFollowing.map((f) => f.followingId)
          );
          const filtered = visible.filter((c) => !followedSet.has(c.id));
          // If cache still has valid entries, serve it (stale-while-revalidate)
          if (filtered.length >= Math.min(2, limit)) {
            const isStale = cacheAgeMs !== null && cacheAgeMs > CACHE_STALE_MS;
            if (isStale) {
              // Refresh in background without blocking response
              void (async () => {
                try {
                  await refreshSuggestions(user.id, limit);
                } catch (error) {
                  logger.error({ err: error }, "background refresh failed");
                }
              })();
              logger.info(
                { ageMs: cacheAgeMs, served: filtered.length, userId: user.id },
                "stale cache served, background refresh queued"
              );
            } else {
              logger.info(
                { ageMs: cacheAgeMs, hit: true, userId: user.id },
                "cache hit"
              );
            }
            return Response.json(filtered.slice(0, limit), {
              headers: { "X-Cache": isStale ? "STALE" : "HIT" },
            });
          }
        } else if (visible.length > 0) {
          return Response.json(visible.slice(0, limit), {
            headers: { "X-Cache": "HIT" },
          });
        }
      }
    }

    // --- Distributed lock to prevent thundering herd ---
    const lockKey = SUGGESTED_LOCK_KEY(user.id);
    const lockAcquired =
      (await redis.set(lockKey, "1", "EX", SUGGESTED_LOCK_TTL, "NX")) === "OK";
    if (!lockAcquired) {
      // Another request is already computing suggestions for this user
      if (cached) {
        const visible = (cached as { id: string }[]).filter(
          (c) => c.id !== SYSTEM_MODERATION_USER_ID
        );
        logger.info(
          { userId: user.id },
          "lock contention, serving stale cache"
        );
        return Response.json(visible.slice(0, limit), {
          headers: { "X-Cache": "STALE" },
        });
      }
      // No cache at all and lock held -> wait briefly then retry
      await delay(200);
      const retry = await suggestedUsersCache.get(user.id);
      if (retry) {
        const visible = (retry as { id: string }[]).filter(
          (c) => c.id !== SYSTEM_MODERATION_USER_ID
        );
        return Response.json(visible.slice(0, limit), {
          headers: { "X-Cache": "STALE" },
        });
      }
    }

    let result: unknown;
    try {
      result = await computePersonalizedSuggestions(user.id, limit);
    } finally {
      if (lockAcquired) {
        await redis.del(lockKey).catch(() => {
          /* empty */
        });
      }
    }

    const ms = Date.now() - startedAt;
    logger.info(
      {
        count: Array.isArray(result) ? (result as unknown[]).length : 0,
        limit,
        ms,
        userId: user.id,
      },
      "personalized suggestions computed"
    );
    return Response.json(result, { headers: { "X-Cache": "MISS" } });
  } catch (error) {
    logger.error({ err: error }, "failed to fetch suggested users");
    return Response.json(
      { error: "Failed to fetch suggested users" },
      { status: 500 }
    );
  }
}

async function refreshSuggestions(userId: string, limit: number) {
  const fresh = await computePersonalizedSuggestions(userId, limit);
  await suggestedUsersCache.set(
    userId,
    fresh as unknown as Record<string, unknown>[] & { _cachedAt?: number }
  );
}

async function computePersonalizedSuggestions(userId: string, limit: number) {
  const recentlyShownKey = RECENTLY_SHOWN_CACHE_KEY(userId);
  const recentlyShown = (await redis.smembers(recentlyShownKey)) || [];

  // Fetch viewer's interests in parallel
  const [following, ownPosts, votedPosts] = await Promise.all([
    prisma.follow.findMany({
      select: { followingId: true },
      where: { followerId: userId },
    }),
    prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      select: { tags: { select: { name: true } } },
      take: 20,
      where: { moderated: false, userId },
    }),
    prisma.vote.findMany({
      orderBy: { createdAt: "desc" },
      select: { post: { select: { tags: { select: { name: true } } } } },
      take: 20,
      where: { userId, value: 1 },
    }),
  ]);

  const followedIds = following.map((f) => f.followingId);
  const ownTags = ownPosts.flatMap((p) => p.tags.map((t) => t.name));
  const likedTags = votedPosts.flatMap(
    (v) => v.post?.tags?.map((t: { name: string }) => t.name) ?? []
  );
  const interests = buildViewerInterests(followedIds, ownTags, likedTags);

  // Candidate pool: exclusion filters, include needed relations for scoring
  const whereAnd: Record<string, unknown>[] = [
    { id: { not: userId } },
    { id: { not: SYSTEM_MODERATION_USER_ID } },
    { banned: false },
    { followers: { none: { followerId: userId } } },
  ];
  if (recentlyShown.length > 0 && recentlyShown.length < 900) {
    // Avoid huge NOT IN lists that blow up query planner
    whereAnd.push({ id: { notIn: recentlyShown } });
  }

  let candidates = await prisma.user.findMany({
    select: {
      ...getUserDataSelect(userId),
      _count: { select: { followers: true, posts: true } },
      aura: true,
      createdAt: true,
      followers: {
        select: {
          follower: {
            select: { avatarUrl: true, displayName: true, username: true },
          },
        },
        where: {
          follower: { followers: { some: { followerId: userId } } },
        },
      },
      posts: {
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, tags: { select: { name: true } } },
        take: 5,
        where: { moderated: false },
      },
    },
    take: 30,
    where: { AND: whereAnd },
  });

  // If pool exhausted, relax recentlyShown filter
  if (candidates.length === 0 && recentlyShown.length > 0) {
    candidates = await prisma.user.findMany({
      select: {
        ...getUserDataSelect(userId),
        _count: { select: { followers: true, posts: true } },
        aura: true,
        createdAt: true,
        followers: {
          select: {
            follower: {
              select: { avatarUrl: true, displayName: true, username: true },
            },
          },
          where: {
            follower: { followers: { some: { followerId: userId } } },
          },
        },
        posts: {
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, tags: { select: { name: true } } },
          take: 5,
          where: { moderated: false },
        },
      },
      take: 30,
      where: {
        AND: [
          { id: { not: userId } },
          { id: { not: SYSTEM_MODERATION_USER_ID } },
          { banned: false },
          { followers: { none: { followerId: userId } } },
        ],
      },
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  // Build scoring candidates
  const scoringCandidates: SuggestionCandidate[] = candidates.map((c) => {
    const candidateTags = new Set(
      c.posts.flatMap((p) => p.tags.map((t) => t.name))
    );
    let overlap = 0;
    for (const t of candidateTags) {
      if (interests.topTags.has(t)) {
        overlap += 1;
      }
    }
    // Also weight by frequency: if candidate shares a high-frequency viewer tag, boost more
    for (const t of candidateTags) {
      const freq = interests.tagFrequency.get(t) ?? 0;
      if (freq > 2) {
        overlap += 0.5;
      }
    }
    const recentPostAt = c.posts[0]?.createdAt ?? null;
    return {
      aura: c.aura,
      createdAt: c.createdAt,
      followerCount: c._count.followers,
      id: c.id,
      mutualCount: c.followers.length,
      mutualFollowers: c.followers.map((f) => f.follower),
      postCount: c._count.posts,
      recentPostAt,
      tagOverlap: overlap,
    };
  });

  const ranked = rankCandidates(scoringCandidates, interests);
  const diversified = diversifyRanked(ranked, 12);

  // Map back to full user objects for response, preserving rank order
  const idToUser = new Map(candidates.map((c) => [c.id, c]));
  const ordered = diversified
    .map((scored) => {
      const full = idToUser.get(scored.id);
      if (!full) {
        return null;
      }
      return {
        ...full,
        _reasons: scored.reasons,
        _score: scored.score,
        mutualFollowers: scored.mutualFollowers,
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  // Persist recently shown
  const toCache = ordered.slice(0, 6);
  if (toCache.length > 0) {
    await Promise.all(
      toCache.map((u) => redis.sadd(recentlyShownKey, (u as { id: string }).id))
    );
    await redis.expire(recentlyShownKey, RECENTLY_SHOWN_TTL);
  }

  const transformed = ordered.map((u) => {
    const user = u as (typeof candidates)[number] & {
      _score?: number;
      _reasons?: string[];
      mutualFollowers: unknown[];
    };
    const { followers: _followers, ...rest } = user as unknown as Record<
      string,
      unknown
    >;
    return {
      ...rest,
      mutualFollowers: (user as { mutualFollowers: unknown[] }).mutualFollowers,
    };
  });

  // Wrap with timestamp for stale-while-revalidate
  const payload = { _cachedAt: Date.now(), _data: transformed };
  await suggestedUsersCache.set(
    userId,
    payload as unknown as Record<string, unknown>[]
  );

  // Return up to limit, but include a couple extras for client-side optimistic filtering
  return transformed.slice(0, limit);
}
