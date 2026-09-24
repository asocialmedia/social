// For-You feed service: fetches a fresh candidate pool, builds (and caches)
// the user's taste persona, ranks candidates using semantic embeddings and
// media features, and returns diverse pages with continuous pagination.

import { createLogger } from "@asm/logger";
import { and } from "@prisma/orm-postgres/orm-client";

import { searchCache } from "../../cache/search-cache";
import { getAuraSignalsForUsers } from "../aura/signals";
import { getPostDataQuery, mapPostData } from "../client";
import type { PostData } from "../client";
import { communityVisibilityWhere } from "../communities/service";
import prisma, { toPrismaDateTime, fromPrismaDateTime } from "../prisma";
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

// 15 minutes cache TTL for user taste profiles.
const PROFILE_CACHE_TTL_SECONDS = 900;

// Engagement history window for profile building (30 days).
const PROFILE_SIGNAL_WINDOW_DAYS = 30;
const PROFILE_SIGNAL_WINDOW_MS =
  PROFILE_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const PROFILE_EMBEDDING_TAKE = 100;
const RECOMMENDATION_EVENT_TAKE = 200;
// A "Not interested" is a durable hide, so those posts are excluded from the
// For-You pool outright rather than only down-weighted through the profile.
// Bounded so a heavy dismisser cannot build an unbounded NOT IN list; the most
// recent dismissals win and the oldest fall off once the cap is reached.
const NOT_INTERESTED_EXCLUSION_LIMIT = 500;
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

function getAuthorTagsQuery() {
  return prisma.orm.public.Posts.select(
    "createdAt",
    "embedding",
    "isGust",
    "semanticTags",
    "userId"
  )
    .include("postMedias", (media) => media.select("_type"))
    .include("postToTags", (postTags) =>
      postTags.include("tag", (tag) => tag.select("name"))
    )
    .include("user", (user) =>
      user.include("sessions", (sessions) =>
        sessions
          .select("country")
          .orderBy((session) => session.updatedAt.desc())
          .limit(1)
      )
    );
}

type AuthorTagsPost = Awaited<
  ReturnType<ReturnType<typeof getAuthorTagsQuery>["all"]>
>[number];

function toAuthorSignalPost(post: AuthorTagsPost) {
  return {
    ...post,
    attachments: post.postMedias.map((media) => ({ type: media._type })),
    embedding: post.embedding ?? [],
    tags: post.postToTags.flatMap((postTag) =>
      postTag.tag ? [postTag.tag] : []
    ),
  };
}

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
  const follows = await prisma.orm.public.Follows.select("followingId")
    .where({ followerId: userId })
    .all();
  return follows.map((follow) => follow.followingId);
}

// Posts the viewer explicitly dismissed. This is separate from the profile's
// negative weights: those only lower an author's or tag's future score, while
// this is a hard hide, so the dismissed post itself never returns to the pool.
// Reads the durable NOT_INTERESTED events (the session-only local hide is the
// client's `dismissedIds`); unhiding deletes the event, so the post comes back.
export async function getNotInterestedPostIds(
  userId: string
): Promise<string[]> {
  if (!userId) {
    return [];
  }
  const events = await prisma.orm.public.RecommendationEvents.select("postId")
    .where((event) =>
      and(event.eventType.eq("NOT_INTERESTED"), event.userId.eq(userId))
    )
    .orderBy((event) => event.createdAt.desc())
    .limit(NOT_INTERESTED_EXCLUSION_LIMIT)
    .all();
  // One event per (user, post) is the steady state (hide upserts), but a
  // concurrent double-tap could leave two, so dedupe before the NOT IN.
  return [...new Set(events.map((event) => event.postId))];
}

async function getCollaborativePostWeights(
  userId: string,
  candidatePostIds: string[]
): Promise<Map<string, number>> {
  if (candidatePostIds.length === 0) {
    return new Map();
  }

  const ownSignals = await prisma.orm.public.RecommendationEvents.select(
    "postId"
  )
    .where((event) =>
      and(
        event.eventType.in([...POSITIVE_RECOMMENDATION_EVENTS]),
        event.userId.eq(userId)
      )
    )
    .orderBy((event) => event.createdAt.desc())
    .limit(COLLABORATIVE_SOURCE_TAKE)
    .all();
  const sourcePostIds = [...new Set(ownSignals.map((signal) => signal.postId))];
  if (sourcePostIds.length === 0) {
    return new Map();
  }

  const peerSignals = await prisma.orm.public.RecommendationEvents.select(
    "userId"
  )
    .where((event) =>
      and(
        event.eventType.in([...POSITIVE_RECOMMENDATION_EVENTS]),
        event.postId.in(sourcePostIds),
        event.userId.neq(userId)
      )
    )
    .limit(COLLABORATIVE_PEER_EVENT_TAKE)
    .all();
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

  const candidateSignals = await prisma.orm.public.RecommendationEvents.select(
    "postId",
    "userId"
  )
    .where((event) =>
      and(
        event.eventType.in([...POSITIVE_RECOMMENDATION_EVENTS]),
        event.postId.in(candidatePostIds),
        event.userId.in(peerIds)
      )
    )
    .limit(COLLABORATIVE_CANDIDATE_EVENT_TAKE)
    .all();
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
    prisma.orm.public.Votes.select("createdAt", "postId", "userId")
      .where((vote) =>
        and(
          vote.createdAt.gte(toPrismaDateTime(since)),
          vote.postId.in(candidatePostIds),
          vote.user.some((user) =>
            user.followsFollows.some((follow) => follow.followerId.eq(viewerId))
          ),
          vote.value.eq(1)
        )
      )
      .orderBy((vote) => vote.createdAt.desc())
      .limit(SOCIAL_PROOF_EVENT_TAKE)
      .all(),
    prisma.orm.public.Comments.select("createdAt", "postId", "userId")
      .where((comment) =>
        and(
          comment.createdAt.gte(toPrismaDateTime(since)),
          comment.deleted.eq(false),
          comment.postId.in(candidatePostIds),
          comment.user.some((user) =>
            user.followsFollows.some((follow) => follow.followerId.eq(viewerId))
          )
        )
      )
      .orderBy((comment) => comment.createdAt.desc())
      .limit(SOCIAL_PROOF_EVENT_TAKE)
      .all(),
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
      fromPrismaDateTime(amplification.createdAt)
    );
  }
  for (const comment of comments) {
    addContribution(
      comment.postId,
      comment.userId,
      0.8,
      fromPrismaDateTime(comment.createdAt)
    );
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
    attachments?: readonly { type: string }[];
    embedding?: readonly number[];
    semanticTags?: readonly string[] | null;
    tags: readonly { name: string }[];
    userId: string;
  },
  kind: ProfileSignal["kind"],
  createdAt?: Date
): ProfileSignal {
  return {
    authorId: post.userId,
    createdAt,
    embedding: post.embedding ? [...post.embedding] : undefined,
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
    postToTags: readonly { tag: { name: string } | null }[];
    semanticTags?: readonly string[] | null;
  }[],
  profile: UserProfile
): Map<string, number> {
  const tagFrequency = new Map<string, number>();
  for (const post of pool) {
    const tags = new Set([
      ...post.postToTags.flatMap((postTag) =>
        postTag.tag ? [postTag.tag.name.toLowerCase()] : []
      ),
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
        ...post.postToTags.flatMap((postTag) =>
          postTag.tag ? [postTag.tag.name.toLowerCase()] : []
        ),
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
    prisma.orm.public.Votes.select("createdAt")
      .include("post", (_post) => getAuthorTagsQuery())
      .where((vote) =>
        and(
          vote.createdAt.gte(toPrismaDateTime(since)),
          vote.userId.eq(userId),
          vote.value.gt(0)
        )
      )
      .orderBy((vote) => vote.createdAt.desc())
      .limit(PROFILE_EMBEDDING_TAKE)
      .all(),
    prisma.orm.public.Votes.select("createdAt")
      .include("post", (_post) => getAuthorTagsQuery())
      .where((vote) =>
        and(
          vote.createdAt.gte(toPrismaDateTime(since)),
          vote.userId.eq(userId),
          vote.value.lt(0)
        )
      )
      .orderBy((vote) => vote.createdAt.desc())
      .limit(PROFILE_EMBEDDING_TAKE)
      .all(),
    prisma.orm.public.Bookmarks.select("createdAt")
      .include("post", (_post) => getAuthorTagsQuery())
      .where((bookmark) =>
        and(
          bookmark.createdAt.gte(toPrismaDateTime(since)),
          bookmark.userId.eq(userId)
        )
      )
      .orderBy((bookmark) => bookmark.createdAt.desc())
      .limit(PROFILE_EMBEDDING_TAKE)
      .all(),
    prisma.orm.public.Comments.select("createdAt")
      .include("post", (_post) => getAuthorTagsQuery())
      .where((comment) =>
        and(
          comment.createdAt.gte(toPrismaDateTime(since)),
          comment.deleted.eq(false),
          comment.userId.eq(userId)
        )
      )
      .orderBy((comment) => comment.createdAt.desc())
      .limit(PROFILE_EMBEDDING_TAKE)
      .all(),
    prisma.orm.public.CommentVotes.select("createdAt", "value")
      .include("comment", (comment) =>
        comment.include("post", (_post) => getAuthorTagsQuery())
      )
      .where((commentVote) =>
        and(
          commentVote.createdAt.gte(toPrismaDateTime(since)),
          commentVote.userId.eq(userId)
        )
      )
      .orderBy((commentVote) => commentVote.createdAt.desc())
      .limit(PROFILE_EMBEDDING_TAKE)
      .all(),
    getAuthorTagsQuery()
      .where((post) =>
        and(post.createdAt.gte(toPrismaDateTime(since)), post.userId.eq(userId))
      )
      .orderBy((post) => post.createdAt.desc())
      .limit(PROFILE_EMBEDDING_TAKE)
      .all(),
    prisma.orm.public.RecommendationEvents.select("createdAt", "eventType")
      .include("post", (_post) => getAuthorTagsQuery())
      .where((event) =>
        and(
          event.createdAt.gte(toPrismaDateTime(since)),
          event.userId.eq(userId)
        )
      )
      .orderBy((event) => event.createdAt.desc())
      .limit(RECOMMENDATION_EVENT_TAKE)
      .all(),
    searchCache.getHistory(userId),
    fetchFollowedAuthorIds(userId),
  ]);

  const signals: ProfileSignal[] = [];
  for (const vote of votes) {
    if (vote.post) {
      signals.push(
        toSignal(
          toAuthorSignalPost(vote.post),
          "amplify",
          fromPrismaDateTime(vote.createdAt)
        )
      );
    }
  }
  for (const downvote of downvotes) {
    if (downvote.post) {
      signals.push(
        toSignal(
          toAuthorSignalPost(downvote.post),
          "downvote",
          fromPrismaDateTime(downvote.createdAt)
        )
      );
    }
  }
  for (const bookmark of bookmarks) {
    if (bookmark.post) {
      signals.push(
        toSignal(
          toAuthorSignalPost(bookmark.post),
          "bookmark",
          fromPrismaDateTime(bookmark.createdAt)
        )
      );
    }
  }
  for (const comment of comments) {
    if (comment.post) {
      signals.push(
        toSignal(
          toAuthorSignalPost(comment.post),
          "comment",
          fromPrismaDateTime(comment.createdAt)
        )
      );
    }
  }
  for (const commentVote of commentVotes) {
    if (commentVote.comment?.post) {
      signals.push(
        toSignal(
          toAuthorSignalPost(commentVote.comment.post),
          commentVote.value > 0 ? "commentVote" : "downvote",
          fromPrismaDateTime(commentVote.createdAt)
        )
      );
    }
  }
  for (const event of recommendationEvents) {
    const eventKind = getRecommendationEventKind(event.eventType);
    if (eventKind && event.post) {
      signals.push(
        toSignal(
          toAuthorSignalPost(event.post),
          eventKind,
          fromPrismaDateTime(event.createdAt)
        )
      );
    }
  }
  for (const ownPost of ownPosts) {
    signals.push(
      toSignal(
        toAuthorSignalPost(ownPost),
        ownPost.isGust ? "ownGust" : "ownPost",
        fromPrismaDateTime(ownPost.createdAt)
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

  // Resolved alongside the pool so a dismissed post is filtered by the query
  // itself. Without this, "Not interested" only hid the post for the session
  // and the next page load could rank it straight back in.
  const notInterestedPostIds = await getNotInterestedPostIds(userId);

  const contentKind = options.contentKind ?? "post";
  const visibilityPredicate = communityVisibilityWhere(userId);
  const [pool, profile, viewerSession] = await Promise.all([
    prisma.orm.public.Posts.select(
      "aura",
      "createdAt",
      "embedding",
      "id",
      "semanticTags",
      "userId",
      "viewCount"
    )
      .include("bookmarks", (bookmarks) =>
        bookmarks.combine({ total: bookmarks.count() })
      )
      .include("comments", (comments) => comments.count())
      .include("postMedias", (media) =>
        media.select("_type", "ocrText", "transcript")
      )
      .include("postToTags", (postTags) =>
        postTags.include("tag", (tag) => tag.select("name"))
      )
      .include("user", (user) =>
        user.include("sessions", (sessions) =>
          sessions
            .select("country")
            .orderBy((session) => session.updatedAt.desc())
            .limit(1)
        )
      )
      .include("postVisits", (visits) =>
        visits
          .select("id")
          .where((visit) => visit.userId.eq(userId))
          .limit(1)
      )
      .where((post) => {
        const predicates = [
          post.createdAt.lte(toPrismaDateTime(now)),
          post.isGust.eq(contentKind === "gust"),
          post.userId.neq(userId),
          visibilityPredicate(post),
        ];
        if (excludeModerated) {
          predicates.push(post.moderated.eq(false));
        }
        if (contentKind === "gust") {
          predicates.push(
            post.postMedias.some((media) => media._type.eq("VIDEO"))
          );
        }
        if (!includeVisited) {
          predicates.push(
            post.postVisits.none((visit) => visit.userId.eq(userId))
          );
        }
        if (notInterestedPostIds.length > 0) {
          predicates.push(post.id.notIn(notInterestedPostIds));
        }
        return and(...predicates);
      })
      .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()])
      .limit(CANDIDATE_POOL_SIZE)
      .all(),
    getProfile(userId),
    prisma.orm.public.Sessions.select("country")
      .where({ userId })
      .orderBy((session) => session.updatedAt.desc())
      .first(),
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
    const attachments = post.postMedias;
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
      bookmarkCount: post.bookmarks.total,
      commentCount: post.comments,
      createdAt: fromPrismaDateTime(post.createdAt),
      embedding: post.embedding ? [...post.embedding] : [],
      hasAudio: attachments.some((attachment) => attachment._type === "AUDIO"),
      hasImage: attachments.some((attachment) => attachment._type === "IMAGE"),
      hasOcr: attachments.some((attachment) =>
        Boolean(attachment.ocrText?.length)
      ),
      hasTranscript: attachments.some((attachment) =>
        Boolean(attachment.transcript?.length)
      ),
      hasVideo: attachments.some((attachment) => attachment._type === "VIDEO"),
      id: post.id,
      isVisited: post.postVisits.length > 0,
      semanticTags: post.semanticTags ? [...post.semanticTags] : undefined,
      tags: post.postToTags.flatMap((postTag) =>
        postTag.tag ? [postTag.tag.name] : []
      ),
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
  const fullPosts = await getPostDataQuery(prisma.orm, userId)
    .where((post) => post.id.in(rankedIds))
    .all();
  const byId = new Map(
    fullPosts.map((post) => [post.id, mapPostData(post)] as const)
  );
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
