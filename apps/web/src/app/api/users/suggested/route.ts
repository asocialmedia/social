import { setTimeout as delay } from "node:timers/promises";

import {
  and,
  consumeRateLimit,
  getClientIpFromRequest,
  fromPrismaDateTime,
  getUserDataQuery,
  mapUserData,
  prisma,
  redis,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";
import { suggestedUsersCache } from "@/lib/users/suggested-users-cache";
import {
  buildViewerInterests,
  diversifyRanked,
  rankCandidates,
} from "@/lib/users/suggested-users-scoring";
import type { SuggestionCandidate } from "@/lib/users/suggested-users-scoring";

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
      const guestUsers = await getUserDataQuery(prisma.orm, "")
        .where((candidate) =>
          and(
            candidate.banned.eq(false),
            candidate.id.notIn([SYSTEM_MODERATION_USER_ID])
          )
        )
        .orderBy((candidate) => candidate.aura.desc())
        .limit(limit)
        .all()
        .then((rows) => rows.map(mapUserData));
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
          const stillNotFollowing = await prisma.orm.public.Follows.select(
            "followingId"
          )
            .where((follow) =>
              and(
                follow.followerId.eq(user.id),
                follow.followingId.in(cachedIds)
              )
            )
            .all();
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

async function loadSuggestedCandidates(
  userId: string,
  recentlyShown: string[]
) {
  return await getUserDataQuery(prisma.orm, userId)
    .where((candidate) =>
      and(
        candidate.id.notIn([userId, SYSTEM_MODERATION_USER_ID]),
        candidate.banned.eq(false),
        candidate.followsFollows.none((follow) => follow.followerId.eq(userId)),
        ...(recentlyShown.length > 0 && recentlyShown.length < 900
          ? [candidate.id.notIn(recentlyShown)]
          : [])
      )
    )
    .include("posts", (posts) =>
      posts
        .where((post) => post.moderated.eq(false))
        .orderBy((post) => post.createdAt.desc())
        .limit(5)
        .select("createdAt", "semanticTags")
        .include("postToTags", (postTag) =>
          postTag.include("tag", (tag) => tag.select("name"))
        )
    )
    .limit(30)
    .all();
}

async function computePersonalizedSuggestions(userId: string, limit: number) {
  const recentlyShownKey = RECENTLY_SHOWN_CACHE_KEY(userId);
  const recentlyShown = (await redis.smembers(recentlyShownKey)) || [];

  // Fetch viewer's interests in parallel
  const [following, ownPosts, votedPosts] = await Promise.all([
    prisma.orm.public.Follows.select("followingId")
      .where({ followerId: userId })
      .all(),
    prisma.orm.public.Posts.select("id")
      .include("postToTags", (postTag) =>
        postTag.include("tag", (tag) => tag.select("name"))
      )
      .where((post) =>
        and(
          post.moderated.eq(false),
          post.rootPostId.isNull(),
          post.userId.eq(userId)
        )
      )
      .orderBy((post) => post.createdAt.desc())
      .limit(20)
      .all(),
    prisma.orm.public.Votes.where((vote) =>
      and(vote.userId.eq(userId), vote.value.eq(1))
    )
      .include("post", (post) =>
        post.include("postToTags", (postTag) =>
          postTag.include("tag", (tag) => tag.select("name"))
        )
      )
      .orderBy((vote) => vote.createdAt.desc())
      .limit(20)
      .all(),
  ]);

  const followedIds = following.map((f) => f.followingId);
  const ownTags = ownPosts.flatMap((post) =>
    post.postToTags.flatMap((postTag) =>
      postTag.tag ? [postTag.tag.name] : []
    )
  );
  const likedTags = votedPosts.flatMap((vote) =>
    vote.post
      ? vote.post.postToTags.flatMap((postTag) =>
          postTag.tag ? [postTag.tag.name] : []
        )
      : []
  );
  const interests = buildViewerInterests(followedIds, ownTags, likedTags);

  // Candidate pool: exclusion filters, include needed relations for scoring
  let candidates = await loadSuggestedCandidates(userId, recentlyShown);

  // If pool exhausted, relax recentlyShown filter
  if (candidates.length === 0 && recentlyShown.length > 0) {
    candidates = await loadSuggestedCandidates(userId, []);
  }

  if (candidates.length === 0) {
    return [];
  }

  const candidateIds = candidates.map((candidate) => candidate.id);
  const followingIds = following.map((follow) => follow.followingId);
  const [followerRows, postCountRows] = await Promise.all([
    prisma.orm.public.Follows.where((follow) =>
      and(
        follow.followingId.in(candidateIds),
        follow.followerId.in(followingIds)
      )
    )
      .include("follower", (follower) =>
        follower.select("avatarUrl", "displayName", "username")
      )
      .all(),
    prisma.orm.public.Posts.where((post) =>
      and(post.userId.in(candidateIds), post.moderated.eq(false))
    )
      .groupBy("userId")
      .aggregate((aggregate) => ({ count: aggregate.count() })),
  ]);
  const followerCounts = new Map<string, number>();
  const mutualFollowers = new Map<
    string,
    { avatarUrl: string | null; displayName: string; username: string }[]
  >();
  for (const follow of followerRows) {
    followerCounts.set(
      follow.followingId,
      (followerCounts.get(follow.followingId) ?? 0) + 1
    );
    const followers = mutualFollowers.get(follow.followingId) ?? [];
    if (follow.follower) {
      followers.push({
        avatarUrl: follow.follower.avatarUrl,
        displayName: follow.follower.displayName,
        username: follow.follower.username,
      });
    }
    mutualFollowers.set(follow.followingId, followers);
  }
  const postCounts = new Map(
    postCountRows.map((row) => [row.userId, row.count])
  );

  // Build scoring candidates
  const scoringCandidates: SuggestionCandidate[] = candidates.map((c) => {
    const candidateTags = [
      ...new Set([
        ...c.posts.flatMap((post) =>
          post.postToTags.flatMap((postTag) =>
            postTag.tag ? [postTag.tag.name] : []
          )
        ),
        ...c.posts.flatMap((post) => post.semanticTags ?? []),
      ]),
    ].filter(Boolean);

    let overlap = 0;
    let matchedTopic: string | undefined;
    for (const t of candidateTags) {
      if (interests.topTags.has(t)) {
        overlap += 1;
        if (!matchedTopic) {
          matchedTopic = t;
        }
      }
    }
    // Also weight by frequency: if candidate shares a high-frequency viewer tag, boost more
    for (const t of candidateTags) {
      const freq = interests.tagFrequency.get(t) ?? 0;
      if (freq > 2) {
        overlap += 0.5;
        if (!matchedTopic) {
          matchedTopic = t;
        }
      }
    }
    const recentPostAt = c.posts[0]?.createdAt
      ? fromPrismaDateTime(c.posts[0].createdAt)
      : null;
    const candidateMutualFollowers = mutualFollowers.get(c.id) ?? [];
    return {
      aura: c.aura,
      createdAt: fromPrismaDateTime(c.createdAt),
      followerCount: followerCounts.get(c.id) ?? 0,
      id: c.id,
      matchedTopic,
      mutualCount: candidateMutualFollowers.length,
      mutualFollowers: candidateMutualFollowers,
      postCount: postCounts.get(c.id) ?? 0,
      recentPostAt,
      tagOverlap: overlap,
    };
  });

  const ranked = rankCandidates(scoringCandidates, interests);
  const diversified = diversifyRanked(ranked, 12);

  // Map back to full user objects for response, preserving rank order
  const idToUser = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );
  const ordered = diversified
    .map((scored) => {
      const full = idToUser.get(scored.id);
      if (!full) {
        return null;
      }
      const { posts: _posts, ...userWithoutPosts } = full;
      return {
        ...mapUserData(userWithoutPosts),
        _count: {
          followers: scored.followerCount,
          posts: scored.postCount,
        },
        _reasons: scored.reasons,
        _score: scored.score,
        mutualFollowers: scored.mutualFollowers,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 12);

  // Persist recently shown
  const toCache = ordered.slice(0, 6);
  if (toCache.length > 0) {
    await Promise.all(
      toCache.map((u) => redis.sadd(recentlyShownKey, (u as { id: string }).id))
    );
    await redis.expire(recentlyShownKey, RECENTLY_SHOWN_TTL);
  }

  const transformed = ordered;

  // Wrap with timestamp for stale-while-revalidate
  const payload = { _cachedAt: Date.now(), _data: transformed };
  await suggestedUsersCache.set(
    userId,
    payload as unknown as Record<string, unknown>[]
  );

  // Return up to limit, but include a couple extras for client-side optimistic filtering
  return transformed.slice(0, limit);
}
