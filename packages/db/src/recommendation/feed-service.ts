// For-You feed service: fetches a fresh candidate pool, builds (and caches)
// the user's taste profile, ranks candidates, and returns one diverse page.
// The route handler owns session/params/cache headers; this module owns all
// recommendation data flow so it stays independently testable.

import { createLogger } from "@asm/logger";

import type { PostData } from "../client";
import { getPostDataInclude } from "../client";
import prisma from "../prisma";
import { redis } from "../redis";
import { buildUserProfile } from "./profile";
import type { ProfileSignal, UserProfile } from "./profile";
import { rankFeed } from "./rank-feed";
import type { ScoredCandidate } from "./rank-feed";
import { scoreCandidate } from "./score-candidate";
import type { CandidatePost } from "./score-candidate";

const logger = createLogger({ serviceName: "fyp-feed" });

// The candidate pool is intentionally small and recent: recommendations over
// stale content feel broken, and 500 rows keeps scoring work bounded.
const CANDIDATE_POOL_SIZE = 500;
const CANDIDATE_WINDOW_HOURS = 72;
const CANDIDATE_POOL_TAKE = { take: CANDIDATE_POOL_SIZE };

// Profiles change slowly relative to feed requests; 15 minutes of caching
// absorbs burst traffic without letting taste go noticeably stale.
const PROFILE_CACHE_TTL_SECONDS = 900;

// Engagement history window for profile building.
const PROFILE_SIGNAL_WINDOW_DAYS = 30;
const PROFILE_SIGNAL_WINDOW_MS =
  PROFILE_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const FYP_PROFILE_KEY_PREFIX = "fyp-profile:";

interface CachedProfile extends UserProfile {
  followedAuthorIds: string[];
}

const AUTHOR_TAGS_SELECT = {
  select: {
    tags: { select: { name: true } },
    userId: true,
  },
} as const;

export interface PersonalizedFeedPage {
  // Id of the OLDEST post in the candidate pool. The route uses it as the
  // cursor for strict recency continuation: everything newer than this post
  // was in the pool (so ranking already had its say), and everything older
  // streams in gap-free, so page 1 -> page 2 can neither repeat nor skip.
  anchorCursor: string | null;
  posts: PostData[];
}

function fypProfileKey(userId: string): string {
  return `${FYP_PROFILE_KEY_PREFIX}${userId}`;
}

async function fetchFollowedAuthorIds(userId: string): Promise<string[]> {
  const follows = await prisma.follow.findMany({
    select: { followingId: true },
    where: { followerId: userId },
  });
  return follows.map((follow) => follow.followingId);
}

// Joins the user's recent positive engagement through to the engaged posts'
// authors and tags, then folds everything into the pure profile builder.
export async function buildAndCacheProfile(
  userId: string
): Promise<CachedProfile> {
  const since = new Date(Date.now() - PROFILE_SIGNAL_WINDOW_MS);
  const [votes, bookmarks, comments, commentVotes, followedAuthorIds] =
    await Promise.all([
      prisma.vote.findMany({
        select: { post: AUTHOR_TAGS_SELECT },
        where: { createdAt: { gte: since }, userId, value: { gt: 0 } },
      }),
      prisma.bookmark.findMany({
        select: { post: AUTHOR_TAGS_SELECT },
        where: { createdAt: { gte: since }, userId },
      }),
      prisma.comment.findMany({
        select: { post: AUTHOR_TAGS_SELECT },
        where: { createdAt: { gte: since }, deleted: false, userId },
      }),
      prisma.commentVote.findMany({
        select: { comment: { select: { post: AUTHOR_TAGS_SELECT } } },
        where: { createdAt: { gte: since }, userId },
      }),
      fetchFollowedAuthorIds(userId),
    ]);

  const signals: ProfileSignal[] = [];
  for (const vote of votes) {
    if (vote.post) {
      signals.push({
        authorId: vote.post.userId,
        kind: "amplify",
        tags: vote.post.tags.map((tag) => tag.name),
      });
    }
  }
  for (const bookmark of bookmarks) {
    if (bookmark.post) {
      signals.push({
        authorId: bookmark.post.userId,
        kind: "bookmark",
        tags: bookmark.post.tags.map((tag) => tag.name),
      });
    }
  }
  for (const comment of comments) {
    if (comment.post) {
      signals.push({
        authorId: comment.post.userId,
        kind: "comment",
        tags: comment.post.tags.map((tag) => tag.name),
      });
    }
  }
  for (const commentVote of commentVotes) {
    if (commentVote.comment?.post) {
      signals.push({
        authorId: commentVote.comment.post.userId,
        kind: "commentVote",
        tags: commentVote.comment.post.tags.map((tag) => tag.name),
      });
    }
  }

  const profile: CachedProfile = {
    ...buildUserProfile(signals),
    followedAuthorIds,
  };

  // Fail-open on cache errors: an unavailable Redis must not break the feed,
  // it only costs us recompute-per-request.
  try {
    await redis.set(
      fypProfileKey(userId),
      JSON.stringify(profile),
      "EX",
      PROFILE_CACHE_TTL_SECONDS
    );
  } catch (error) {
    logger.warn({ error }, "fyp profile cache write failed");
  }
  return profile;
}

async function getProfile(userId: string): Promise<CachedProfile> {
  try {
    const cached = await redis.get(fypProfileKey(userId));
    if (cached) {
      return JSON.parse(cached) as CachedProfile;
    }
  } catch (error) {
    logger.warn({ error }, "fyp profile cache read failed");
  }
  return await buildAndCacheProfile(userId);
}

// Drops the cached taste profile so the next feed request rebuilds it from
// fresh engagement. Best-effort by design: callers fire this after bookmark /
// vote / comment mutations so a user's own actions shape their very next
// feed load instead of waiting out the 15-minute TTL.
export async function invalidateFypProfile(userId: string): Promise<void> {
  try {
    await redis.del(fypProfileKey(userId));
  } catch (error) {
    logger.warn({ error }, "fyp profile invalidation failed");
  }
}

// Fetches the personalized first page for a signed-in user. Empty posts mean
// there was nothing worth ranking; the caller falls back to recency.
export async function getPersonalizedFeedPage(options: {
  excludeModerated?: boolean;
  pageSize: number;
  userId: string;
}): Promise<PersonalizedFeedPage> {
  const { excludeModerated = false, pageSize, userId } = options;
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - CANDIDATE_WINDOW_HOURS * 60 * 60 * 1000
  );

  const [pool, profile] = await Promise.all([
    prisma.post.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        _count: { select: { bookmarks: true, comments: true } },
        aura: true,
        createdAt: true,
        id: true,
        tags: { select: { name: true } },
        userId: true,
        viewCount: true,
      },
      where: {
        createdAt: { gte: windowStart },
        // Posts the user has already visited are old news to them.
        isGust: false,
        moderated: excludeModerated ? false : undefined,
        visits: { none: { userId } },
      },
      ...CANDIDATE_POOL_TAKE,
    }),
    getProfile(userId),
  ]);

  if (pool.length === 0) {
    return { anchorCursor: null, posts: [] };
  }

  const followedAuthorIds = new Set(profile.followedAuthorIds);
  const scored: ScoredCandidate<CandidatePost>[] = pool.map((post) => {
    const candidate: CandidatePost = {
      aura: post.aura,
      authorId: post.userId,
      bookmarkCount: post._count.bookmarks,
      commentCount: post._count.comments,
      createdAt: post.createdAt,
      id: post.id,
      tags: post.tags.map((tag) => tag.name),
    };
    return {
      post: candidate,
      score: scoreCandidate(candidate, profile, {
        followedAuthorIds,
        now,
      }),
    };
  });

  // rankFeed returns bare posts; keep scores alongside for the debug log.
  const scoreById = new Map(
    scored.map((entry) => [entry.post.id, entry.score])
  );
  const ranked = rankFeed(scored, { pageSize });
  const topScores = ranked
    .slice(0, 5)
    .map((post) => Math.round((scoreById.get(post.id) ?? 0) * 10) / 10);
  logger.debug({ topScores, userId }, "fyp page ranked");

  // Preserve rank order through the include-fetch: Postgres has no
  // order-preserving IN, so reorder by the ranked id sequence.
  const rankedIds = ranked.map((post) => post.id);
  const fullPosts = await prisma.post.findMany({
    include: getPostDataInclude(userId),
    where: { id: { in: rankedIds } },
  });
  const byId = new Map(fullPosts.map((post) => [post.id, post]));
  const orderedPosts = rankedIds
    .map((id) => byId.get(id))
    .filter((post): post is PostData => post !== undefined);

  return {
    // Oldest pool post, NOT the last served one: ranking drops pool members
    // (page cutoff, diversity caps), so anchoring on served posts would let
    // unserved newer posts fall between the pages forever. Everything newer
    // than the oldest pool post was ranked; everything older streams in gap-free.
    anchorCursor: pool.at(-1)?.id ?? null,
    posts: orderedPosts,
  };
}
