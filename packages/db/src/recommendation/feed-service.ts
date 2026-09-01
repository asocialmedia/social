// For-You feed service: fetches a fresh candidate pool, builds (and caches)
// the user's taste persona, ranks candidates using semantic embeddings and
// media features, and returns diverse, unskippable pages with continuous pagination.

import { createLogger } from "@asm/logger";

import { searchCache } from "../../cache/search-cache";
import { getAuraSignalsForUsers } from "../aura/signals";
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

// Candidate pool window: 72 hours of recent posts.
const CANDIDATE_POOL_SIZE = 500;
const CANDIDATE_WINDOW_HOURS = 72;
const CANDIDATE_POOL_TAKE = { take: CANDIDATE_POOL_SIZE };

// 15 minutes cache TTL for user taste profiles.
const PROFILE_CACHE_TTL_SECONDS = 900;

// Engagement history window for profile building (30 days).
const PROFILE_SIGNAL_WINDOW_DAYS = 30;
const PROFILE_SIGNAL_WINDOW_MS =
  PROFILE_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const PROFILE_SIGNALS_TAKE = 500;

export const FYP_PROFILE_KEY_PREFIX = "fyp-profile:";

interface CachedProfile extends UserProfile {
  followedAuthorIds: string[];
}

const AUTHOR_TAGS_SELECT = {
  select: {
    attachments: { select: { type: true } },
    embedding: true,
    isGust: true,
    semanticTags: true,
    tags: { select: { name: true } },
    userId: true,
  },
} as const;

export interface PersonalizedFeedPage {
  anchorCursor: string | null;
  nextCursor?: string | null;
  posts: PostData[];
}

export interface GetPersonalizedFeedOptions {
  cursor?: string;
  excludeModerated?: boolean;
  includeVisited?: boolean;
  pageSize: number;
  userId: string;
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

function toSignal(
  post: {
    attachments?: { type: string }[];
    embedding?: number[];
    semanticTags?: string[] | null;
    tags: { name: string }[];
    userId: string;
  },
  kind: ProfileSignal["kind"],
  createdAt?: Date
): ProfileSignal {
  return {
    authorId: post.userId,
    createdAt,
    embedding: post.embedding,
    hasAudio: post.attachments?.some((a) => a.type === "AUDIO"),
    hasImage: post.attachments?.some((a) => a.type === "IMAGE"),
    hasVideo: post.attachments?.some((a) => a.type === "VIDEO"),
    kind,
    tags: [...post.tags.map((tag) => tag.name), ...(post.semanticTags ?? [])],
  };
}

// Joins recent engagement (votes, bookmarks, comments, comment votes, searches) through to
// posts, media types, and embeddings, constructing a comprehensive UserPersona.
export async function buildAndCacheProfile(
  userId: string
): Promise<CachedProfile> {
  const since = new Date(Date.now() - PROFILE_SIGNAL_WINDOW_MS);
  const [
    votes,
    downvotes,
    bookmarks,
    comments,
    commentVotes,
    ownPosts,
    searches,
    followedAuthorIds,
  ] = await Promise.all([
    prisma.vote.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_SIGNALS_TAKE,
      where: { createdAt: { gte: since }, userId, value: { gt: 0 } },
    }),
    prisma.vote.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_SIGNALS_TAKE,
      where: { createdAt: { gte: since }, userId, value: { lt: 0 } },
    }),
    prisma.bookmark.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_SIGNALS_TAKE,
      where: { createdAt: { gte: since }, userId },
    }),
    prisma.comment.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_SIGNALS_TAKE,
      where: { createdAt: { gte: since }, deleted: false, userId },
    }),
    prisma.commentVote.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        comment: { select: { post: AUTHOR_TAGS_SELECT } },
        createdAt: true,
      },
      take: PROFILE_SIGNALS_TAKE,
      where: { createdAt: { gte: since }, userId },
    }),
    prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      select: { ...AUTHOR_TAGS_SELECT.select, createdAt: true },
      take: PROFILE_SIGNALS_TAKE,
      where: { createdAt: { gte: since }, userId },
    }),
    searchCache.getHistory(userId),
    fetchFollowedAuthorIds(userId),
  ]);

  const signals: ProfileSignal[] = [];
  for (const vote of votes) {
    if (vote.post) {
      signals.push(toSignal(vote.post, "amplify", vote.createdAt));
    }
  }
  for (const downvote of downvotes) {
    if (downvote.post) {
      signals.push(toSignal(downvote.post, "downvote", downvote.createdAt));
    }
  }
  for (const bookmark of bookmarks) {
    if (bookmark.post) {
      signals.push(toSignal(bookmark.post, "bookmark", bookmark.createdAt));
    }
  }
  for (const comment of comments) {
    if (comment.post) {
      signals.push(toSignal(comment.post, "comment", comment.createdAt));
    }
  }
  for (const commentVote of commentVotes) {
    if (commentVote.comment?.post) {
      signals.push(
        toSignal(commentVote.comment.post, "commentVote", commentVote.createdAt)
      );
    }
  }
  for (const ownPost of ownPosts) {
    signals.push(
      toSignal(
        ownPost,
        ownPost.isGust ? "ownGust" : "ownPost",
        ownPost.createdAt
      )
    );
  }
  for (const search of searches) {
    const searchDate = search.searchedAt
      ? new Date(search.searchedAt)
      : undefined;
    if (search.type === "query" && search.query) {
      const terms = search.query
        .toLowerCase()
        .split(/[^a-z0-9_-]+/)
        .filter((t) => t.length >= 2);
      if (terms.length > 0) {
        signals.push({
          authorId: "",
          createdAt: searchDate,
          kind: "search",
          tags: terms,
        });
      }
    } else if (search.type === "user" && search.user) {
      signals.push({
        authorId: search.user.id,
        createdAt: searchDate,
        kind: "search",
        tags: [],
      });
    } else if (search.type === "post" && search.post) {
      const contentTags =
        search.post.content
          .match(/#(?<tag>[a-zA-Z0-9_-]+)/g)
          ?.map((t) => t.slice(1).toLowerCase()) ?? [];
      signals.push({
        authorId: search.post.authorId,
        createdAt: searchDate,
        kind: "search",
        tags: contentTags,
      });
    }
  }

  const profile: CachedProfile = {
    ...buildUserProfile(signals),
    followedAuthorIds,
  };

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

export async function invalidateFypProfile(userId: string): Promise<void> {
  try {
    await redis.del(fypProfileKey(userId));
  } catch (error) {
    logger.warn({ error }, "fyp profile invalidation failed");
  }
}

// Fetches a personalized feed page with media feature extraction and continuous ranking.
export async function getPersonalizedFeedPage(
  options: GetPersonalizedFeedOptions
): Promise<PersonalizedFeedPage> {
  const {
    cursor,
    excludeModerated = false,
    includeVisited = false,
    pageSize,
    userId,
  } = options;

  let offset = 0;
  let timestamp = Date.now();

  if (cursor && cursor.startsWith("fyp.")) {
    const parts = cursor.split(".");
    offset = Math.trunc(Number(parts[1] ?? "0")) || 0;
    timestamp = Math.trunc(Number(parts[2] ?? `${Date.now()}`)) || Date.now();
  }

  const now = new Date(timestamp);
  const windowStart = new Date(
    timestamp - CANDIDATE_WINDOW_HOURS * 60 * 60 * 1000
  );

  const whereClause: Record<string, unknown> = {
    createdAt: { gte: windowStart },
    isGust: false,
    moderated: excludeModerated ? false : undefined,
  };

  if (!includeVisited) {
    whereClause.visits = { none: { userId } };
  }

  const [pool, profile] = await Promise.all([
    prisma.post.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        _count: { select: { bookmarks: true, comments: true } },
        attachments: {
          select: { ocrText: true, transcript: true, type: true },
        },
        aura: true,
        createdAt: true,
        embedding: true,
        id: true,
        semanticTags: true,
        tags: { select: { name: true } },
        userId: true,
        viewCount: true,
        visits: { select: { id: true }, take: 1, where: { userId } },
      },
      where: whereClause,
      ...CANDIDATE_POOL_TAKE,
    }),
    getProfile(userId),
  ]);

  if (pool.length === 0) {
    return { anchorCursor: null, nextCursor: null, posts: [] };
  }

  const followedAuthorIds = new Set(profile.followedAuthorIds);
  const authorSignals = await getAuraSignalsForUsers([
    ...new Set(pool.map((post) => post.userId)),
  ]);

  const scored: ScoredCandidate<CandidatePost>[] = pool.map((post) => {
    const attachments = post.attachments ?? [];
    const candidate: CandidatePost = {
      aura: post.aura,
      authorId: post.userId,
      bookmarkCount: post._count.bookmarks,
      commentCount: post._count.comments,
      createdAt: post.createdAt,
      embedding: post.embedding ?? [],
      hasAudio: attachments.some((a) => a.type === "AUDIO"),
      hasImage: attachments.some((a) => a.type === "IMAGE"),
      hasOcr: attachments.some((a) => Boolean(a.ocrText)),
      hasTranscript: attachments.some((a) => Boolean(a.transcript)),
      hasVideo: attachments.some((a) => a.type === "VIDEO"),
      id: post.id,
      isVisited: Boolean(post.visits && post.visits.length > 0),
      semanticTags: post.semanticTags,
      tags: post.tags.map((tag) => tag.name),
    };
    return {
      post: candidate,
      score: scoreCandidate(candidate, profile, {
        authorVisibilityWeight:
          authorSignals.get(post.userId)?.visibilityWeight ?? 1,
        followedAuthorIds,
        now,
      }),
    };
  });

  const ranked = rankFeed(scored, { pageSize: pool.length });
  const sliceStart = offset;
  const sliceEnd = offset + pageSize;
  const pageRanked = ranked.slice(sliceStart, sliceEnd);

  const rankedIds = pageRanked.map((post) => post.id);
  const fullPosts = await prisma.post.findMany({
    include: getPostDataInclude(userId),
    where: { id: { in: rankedIds } },
  });
  const byId = new Map(fullPosts.map((post) => [post.id, post]));
  const orderedPosts = rankedIds
    .map((id) => byId.get(id))
    .filter((post): post is PostData => post !== undefined);

  let nextCursor: string | null = null;
  if (sliceEnd < ranked.length) {
    nextCursor = `fyp.${sliceEnd}.${timestamp}`;
  } else if (pool.length > 0) {
    // Candidates exhausted: transition smoothly to expired posts at bottom
    nextCursor = `exp.${pool.at(-1)?.id ?? ""}`;
  }

  return {
    anchorCursor: pool.at(-1)?.id ?? null,
    nextCursor,
    posts: orderedPosts,
  };
}
