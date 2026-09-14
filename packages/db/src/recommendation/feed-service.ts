// For-You feed service: fetches a fresh candidate pool, builds (and caches)
// the user's taste persona, ranks candidates using semantic embeddings and
// media features, and returns diverse pages with continuous pagination.

import { createLogger } from "@asm/logger";

import { searchCache } from "../../cache/search-cache";
import { getAuraSignalsForUsers } from "../aura/signals";
import type { PostData, Prisma } from "../client";
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

// Rank the newest bounded pool, then continue with the chronological cursor.
// There is no arbitrary age cutoff, so a small community or new account can
// still reach the complete archive while freshness remains a score feature.
const CANDIDATE_POOL_SIZE = 500;
const CANDIDATE_POOL_TAKE = { take: CANDIDATE_POOL_SIZE };

// 15 minutes cache TTL for user taste profiles.
const PROFILE_CACHE_TTL_SECONDS = 900;

// Engagement history window for profile building (30 days).
const PROFILE_SIGNAL_WINDOW_DAYS = 30;
const PROFILE_SIGNAL_WINDOW_MS =
  PROFILE_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const PROFILE_EMBEDDING_TAKE = 100;
const RECOMMENDATION_EVENT_TAKE = 200;
const COLLABORATIVE_SOURCE_TAKE = 100;
const COLLABORATIVE_PEER_EVENT_TAKE = 2000;
const COLLABORATIVE_CANDIDATE_EVENT_TAKE = 5000;
const SOCIAL_PROOF_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SOCIAL_PROOF_EVENT_TAKE = 2000;
const SOCIAL_PROOF_SATURATION = 3;
const POSITIVE_RECOMMENDATION_EVENTS = [
  "VIEW_COMPLETE",
  "DWELL",
  "BOOKMARK",
  "VOTE",
  "COMMENT",
  "SHARE",
] as const;

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
    user: {
      select: {
        sessions: {
          orderBy: { updatedAt: "desc" },
          select: { country: true },
          take: 1,
        },
      },
    },
    userId: true,
  },
} as const;

export interface PersonalizedFeedPage {
  anchorCursor: string | null;
  nextCursor?: string | null;
  posts: PostData[];
}

export interface GetPersonalizedFeedOptions {
  contentKind?: "post" | "gust";
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

async function getCollaborativePostWeights(
  userId: string,
  candidatePostIds: string[]
): Promise<Map<string, number>> {
  if (candidatePostIds.length === 0) {
    return new Map();
  }

  const ownSignals = await prisma.recommendationEvent.findMany({
    orderBy: { createdAt: "desc" },
    select: { postId: true },
    take: COLLABORATIVE_SOURCE_TAKE,
    where: {
      eventType: { in: [...POSITIVE_RECOMMENDATION_EVENTS] },
      userId,
    },
  });
  const sourcePostIds = [...new Set(ownSignals.map((signal) => signal.postId))];
  if (sourcePostIds.length === 0) {
    return new Map();
  }

  const peerSignals = await prisma.recommendationEvent.findMany({
    select: { userId: true },
    take: COLLABORATIVE_PEER_EVENT_TAKE,
    where: {
      eventType: { in: [...POSITIVE_RECOMMENDATION_EVENTS] },
      postId: { in: sourcePostIds },
      userId: { not: userId },
    },
  });
  const peerCounts = new Map<string, number>();
  for (const signal of peerSignals) {
    peerCounts.set(signal.userId, (peerCounts.get(signal.userId) ?? 0) + 1);
  }
  const peerIds = [...peerCounts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([peerId]) => peerId);
  if (peerIds.length === 0) {
    return new Map();
  }

  const candidateSignals = await prisma.recommendationEvent.findMany({
    select: { postId: true, userId: true },
    take: COLLABORATIVE_CANDIDATE_EVENT_TAKE,
    where: {
      eventType: { in: [...POSITIVE_RECOMMENDATION_EVENTS] },
      postId: { in: candidatePostIds },
      userId: { in: peerIds },
    },
  });
  const weights = new Map<string, number>();
  for (const signal of candidateSignals) {
    const peerWeight = peerCounts.get(signal.userId) ?? 1;
    weights.set(
      signal.postId,
      (weights.get(signal.postId) ?? 0) + 1 / peerWeight
    );
  }
  const maximum = Math.max(...weights.values(), 0);
  if (maximum <= 0) {
    return new Map();
  }
  for (const [postId, weight] of weights) {
    weights.set(postId, Math.min(1, weight / maximum));
  }
  return weights;
}

function socialProofRecencyWeight(createdAt: Date, now: Date): number {
  const ageHours = Math.max(
    0,
    (now.getTime() - createdAt.getTime()) / 3_600_000
  );
  return 0.5 ** (ageHours / (7 * 24));
}

export async function getSocialProofPostWeights(
  viewerId: string,
  candidatePostIds: string[],
  now: Date
): Promise<Map<string, number>> {
  if (candidatePostIds.length === 0) {
    return new Map();
  }

  const since = new Date(now.getTime() - SOCIAL_PROOF_WINDOW_MS);
  const [amplifications, comments] = await Promise.all([
    prisma.vote.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, postId: true, userId: true },
      take: SOCIAL_PROOF_EVENT_TAKE,
      where: {
        createdAt: { gte: since },
        postId: { in: candidatePostIds },
        user: { followers: { some: { followerId: viewerId } } },
        value: 1,
      },
    }),
    prisma.comment.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, postId: true, userId: true },
      take: SOCIAL_PROOF_EVENT_TAKE,
      where: {
        createdAt: { gte: since },
        deleted: false,
        postId: { in: candidatePostIds },
        user: { followers: { some: { followerId: viewerId } } },
      },
    }),
  ]);

  // Count at most one action per followed person per post so a single active
  // account cannot dominate the feed by commenting repeatedly.
  const contributionByPost = new Map<string, Map<string, number>>();
  const addContribution = (
    postId: string,
    userId: string,
    baseWeight: number,
    createdAt: Date
  ): void => {
    const byUser = contributionByPost.get(postId) ?? new Map<string, number>();
    const contribution = baseWeight * socialProofRecencyWeight(createdAt, now);
    byUser.set(userId, Math.max(byUser.get(userId) ?? 0, contribution));
    contributionByPost.set(postId, byUser);
  };

  for (const amplification of amplifications) {
    addContribution(
      amplification.postId,
      amplification.userId,
      1,
      amplification.createdAt
    );
  }
  for (const comment of comments) {
    addContribution(comment.postId, comment.userId, 0.8, comment.createdAt);
  }

  const weights = new Map<string, number>();
  for (const [postId, byUser] of contributionByPost) {
    const total = [...byUser.values()].reduce((sum, value) => sum + value, 0);
    weights.set(postId, Math.min(1, total / SOCIAL_PROOF_SATURATION));
  }
  return weights;
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
    tags: [
      ...post.tags.map((tag) => tag.name.toLowerCase()),
      ...(post.semanticTags ?? []).map((t) => t.toLowerCase()),
    ],
  };
}

function buildExplorationAffinities(
  pool: {
    id: string;
    semanticTags?: string[] | null;
    tags: { name: string }[];
  }[],
  profile: UserProfile
): Map<string, number> {
  const tagFrequency = new Map<string, number>();
  for (const post of pool) {
    const tags = new Set([
      ...post.tags.map((tag) => tag.name.toLowerCase()),
      ...(post.semanticTags ?? []).map((tag) => tag.toLowerCase()),
    ]);
    for (const tag of tags) {
      tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
    }
  }

  const isColdStart = (profile.signalCount ?? 0) < 8;
  const explorationScale = isColdStart ? 1 : 0.35;
  const affinities = new Map<string, number>();
  for (const post of pool) {
    const tags = [
      ...new Set([
        ...post.tags.map((tag) => tag.name.toLowerCase()),
        ...(post.semanticTags ?? []).map((tag) => tag.toLowerCase()),
      ]),
    ];
    if (tags.length === 0) {
      affinities.set(post.id, 0.2 * explorationScale);
      continue;
    }
    const rarity =
      tags.reduce(
        (total, tag) => total + 1 / Math.sqrt(tagFrequency.get(tag) ?? 1),
        0
      ) / tags.length;
    const knownTopicMass = tags.reduce(
      (total, tag) => total + (profile.tagWeights?.[tag] ?? 0),
      0
    );
    const unfamiliarity = 1 - Math.min(1, knownTopicMass);
    affinities.set(
      post.id,
      Math.min(1, (rarity * 0.65 + unfamiliarity * 0.35) * explorationScale)
    );
  }
  return affinities;
}

function getRecommendationEventKind(
  eventType: string
): ProfileSignal["kind"] | null {
  switch (eventType) {
    case "VIEW_START": {
      return "view";
    }
    case "VIEW_COMPLETE": {
      return "viewComplete";
    }
    case "DWELL": {
      return "dwell";
    }
    case "SKIP": {
      return "skip";
    }
    case "NOT_INTERESTED": {
      return "notInterested";
    }
    default: {
      return null;
    }
  }
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
    recommendationEvents,
    searches,
    followedAuthorIds,
  ] = await Promise.all([
    prisma.vote.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_EMBEDDING_TAKE,
      where: { createdAt: { gte: since }, userId, value: { gt: 0 } },
    }),
    prisma.vote.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_EMBEDDING_TAKE,
      where: { createdAt: { gte: since }, userId, value: { lt: 0 } },
    }),
    prisma.bookmark.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_EMBEDDING_TAKE,
      where: { createdAt: { gte: since }, userId },
    }),
    prisma.comment.findMany({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, post: AUTHOR_TAGS_SELECT },
      take: PROFILE_EMBEDDING_TAKE,
      where: { createdAt: { gte: since }, deleted: false, userId },
    }),
    prisma.commentVote.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        comment: { select: { post: AUTHOR_TAGS_SELECT } },
        createdAt: true,
        value: true,
      },
      take: PROFILE_EMBEDDING_TAKE,
      where: { createdAt: { gte: since }, userId },
    }),
    prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      select: { ...AUTHOR_TAGS_SELECT.select, createdAt: true },
      take: PROFILE_EMBEDDING_TAKE,
      where: { createdAt: { gte: since }, userId },
    }),
    prisma.recommendationEvent.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        eventType: true,
        post: { select: AUTHOR_TAGS_SELECT.select },
      },
      take: RECOMMENDATION_EVENT_TAKE,
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
        toSignal(
          commentVote.comment.post,
          commentVote.value > 0 ? "commentVote" : "downvote",
          commentVote.createdAt
        )
      );
    }
  }
  for (const event of recommendationEvents) {
    const eventKind = getRecommendationEventKind(event.eventType);
    if (eventKind && event.post) {
      signals.push(toSignal(event.post, eventKind, event.createdAt));
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
      const rawContent =
        typeof search.post.content === "string" ? search.post.content : "";
      const contentTags =
        rawContent
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

  logger.debug(
    {
      signalCount: profile.signalCount ?? 0,
      topTags: profile.summary?.topTags ?? [],
      userId,
    },
    "fyp profile built"
  );

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
      const profile = JSON.parse(cached) as CachedProfile;
      logger.debug(
        { signalCount: profile.signalCount ?? 0, userId },
        "fyp profile cache hit"
      );
      return profile;
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
    // New cursors include the content kind (`fyp.gust.20.timestamp`), while
    // the two-part form remains readable for existing post-feed cursors.
    const cursorOffsetIndex =
      parts[1] === "post" || parts[1] === "gust" ? 2 : 1;
    const rawOffset = Math.trunc(Number(parts[cursorOffsetIndex] ?? "0")) || 0;
    const rawTimestamp =
      Math.trunc(Number(parts[cursorOffsetIndex + 1] ?? `${Date.now()}`)) ||
      Date.now();
    // Clamp offset to valid bounds and timestamp to supported range
    offset = Math.max(0, Math.min(rawOffset, CANDIDATE_POOL_SIZE));
    const maxTimestamp = Date.now() + 60_000;
    const minTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
    timestamp = Math.min(Math.max(rawTimestamp, minTimestamp), maxTimestamp);
  }

  const now = new Date(timestamp);

  const contentKind = options.contentKind ?? "post";
  const whereClause: Prisma.PostWhereInput = {
    createdAt: { lte: now },
    isGust: contentKind === "gust",
    moderated: excludeModerated ? false : undefined,
    userId: { not: userId },
  };
  if (contentKind === "gust") {
    whereClause.attachments = { some: { type: "VIDEO" } };
  }

  if (!includeVisited) {
    whereClause.visits = { none: { userId } };
  }

  const [pool, profile, viewerSession] = await Promise.all([
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
        user: {
          select: {
            sessions: {
              orderBy: { updatedAt: "desc" },
              select: { country: true },
              take: 1,
            },
          },
        },
        userId: true,
        viewCount: true,
        visits: { select: { id: true }, take: 1, where: { userId } },
      },
      where: whereClause,
      ...CANDIDATE_POOL_TAKE,
    }),
    getProfile(userId),
    prisma.session.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { country: true },
      where: { userId },
    }),
  ]);

  if (pool.length === 0) {
    return { anchorCursor: null, nextCursor: null, posts: [] };
  }

  const followedAuthorIds = new Set(profile.followedAuthorIds);
  const [authorSignals, collaborativeWeights, socialProofWeights] =
    await Promise.all([
      getAuraSignalsForUsers([...new Set(pool.map((post) => post.userId))]),
      getCollaborativePostWeights(
        userId,
        pool.map((post) => post.id)
      ),
      getSocialProofPostWeights(
        userId,
        pool.map((post) => post.id),
        now
      ),
    ]);
  const explorationAffinities = buildExplorationAffinities(pool, profile);

  const scored: ScoredCandidate<CandidatePost>[] = pool.map((post) => {
    const attachments = post.attachments ?? [];
    const authorCountry = post.user?.sessions[0]?.country;
    const geographicAffinity =
      viewerSession?.country &&
      authorCountry &&
      viewerSession.country === authorCountry
        ? 1
        : 0;
    const candidate: CandidatePost = {
      aura: post.aura,
      authorCountry,
      authorId: post.userId,
      bookmarkCount: post._count.bookmarks,
      commentCount: post._count.comments,
      createdAt: post.createdAt,
      embedding: post.embedding ?? [],
      hasAudio: attachments.some((a) => a.type === "AUDIO"),
      hasImage: attachments.some((a) => a.type === "IMAGE"),
      hasOcr: attachments.some((a) => Boolean(a.ocrText?.length)),
      hasTranscript: attachments.some((a) => Boolean(a.transcript?.length)),
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
        collaborativeAffinity: collaborativeWeights.get(post.id),
        explorationAffinity: explorationAffinities.get(post.id),
        followedAuthorIds,
        geographicAffinity,
        now,
        socialProofAffinity: socialProofWeights.get(post.id),
      }),
    };
  });

  const ranked = rankFeed(scored, { pageSize: offset + pageSize });
  const sliceStart = offset;
  const sliceEnd = offset + pageSize;
  let pageRanked = ranked.slice(sliceStart, sliceEnd);
  // Second diversity pass ensures each visible page respects author share cap based on pageSize
  if (pageRanked.length > 1) {
    const pageScored = pageRanked.map((post) => {
      const found = scored.find((s) => s.post.id === post.id);
      return found ?? { post, score: 0 };
    });
    pageRanked = rankFeed(pageScored, { pageSize });
  }

  const rankedIds = pageRanked.map((post) => post.id);
  const fullPosts = await prisma.post.findMany({
    include: getPostDataInclude(userId),
    where: { id: { in: rankedIds } },
  });
  const byId = new Map(fullPosts.map((post) => [post.id, post]));
  const orderedPosts = rankedIds
    .map((id) => byId.get(id))
    .filter((post): post is PostData => post !== undefined);

  logger.debug(
    {
      candidateCount: pool.length,
      contentKind,
      profileSignalCount: profile.signalCount ?? 0,
      returnedCount: orderedPosts.length,
      socialProofPostCount: socialProofWeights.size,
      topPostIds: orderedPosts.slice(0, 5).map((post) => post.id),
      userId,
    },
    "fyp feed page ranked"
  );

  let nextCursor: string | null = null;
  if (sliceEnd < ranked.length) {
    nextCursor = `fyp.${contentKind}.${sliceEnd}.${timestamp}`;
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
