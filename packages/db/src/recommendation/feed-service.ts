import { createHash } from "node:crypto";

import { createLogger } from "@asm/logger";
import { and, or } from "@prisma/orm-postgres/orm-client";
// For-You feed service: fetches a fresh candidate pool, builds (and caches)
// the user's taste persona, ranks candidates using semantic embeddings and
// media features, and returns diverse pages with continuous pagination.

import { searchCache } from "../../cache/search-cache";
// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers need the SQL text module declaration.
/// <reference path="../../sql.d.ts" />
import sqlSource from "../../sql/recommendation-retrieval.sql" with { type: "text" };
import { getAuraSignalsForUsers } from "../aura/signals";
import { getPostDataQuery, mapPostData } from "../client";
import type { PostData } from "../client";
import { communityVisibilityWhere } from "../communities/service";
import { rawQuery } from "../messages/infrastructure/raw-sql";
import { readSqlBundle } from "../messages/infrastructure/sql-template";
import prisma, { toPrismaDateTime, fromPrismaDateTime } from "../prisma";
import { redis } from "../redis";
import { attributeFeedPage, rankingAssignment } from "./attribution";
import { buildUserProfile } from "./profile";
import type { ProfileSignal, UserProfile } from "./profile";
import { rankFeed } from "./rank-feed";
import type { ScoredCandidate } from "./rank-feed";
import { scoreCandidate } from "./score-candidate";
import type { CandidatePost } from "./score-candidate";
import { retrieveSemanticCandidates } from "./semantic-index";
import { loadSharedTopicGraph } from "./shared-topic-graph";

const { retrieval } = readSqlBundle(sqlSource, {
  retrieval: ["topics", "collaborative"],
} as const);

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
const SOCIAL_PROOF_CACHE_SECONDS = 120;
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

export const FYP_PROFILE_KEY_PREFIX = "fyp-profile:v4:";

interface CachedProfile extends UserProfile {
  followedAuthorIds: string[];
}

function getAuthorTagsQuery() {
  return prisma.orm.public.Posts.select(
    "createdAt",
    "embedding",
    "embeddingModel",
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
  networkProfile?: UserProfile;
  networkScope?: string;
  contentKind?: "post" | "gust";
  cursor?: string;
  excludeModerated?: boolean;
  includeVisited?: boolean;
  pageSize: number;
  userId: string;
  excludeExplicit?: boolean;
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

  // Social proof depends only on the viewer's follow graph and the candidate
  // set, so a short Redis lease removes the self-join from repeat builds. Fails
  // open: a cache outage must never block a feed read.
  const cacheKey = `rec:social-proof:v1:{${createHash("sha256")
    .update(JSON.stringify([viewerId, [...candidatePostIds].toSorted()]))
    .digest("hex")}}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as [string, number][];
      if (Array.isArray(parsed)) {
        return new Map(parsed);
      }
    }
  } catch {
    // Fall through to the database.
  }

  const weights = await computeSocialProofWeights(
    viewerId,
    candidatePostIds,
    now
  );
  try {
    await redis.set(
      cacheKey,
      JSON.stringify([...weights]),
      "EX",
      SOCIAL_PROOF_CACHE_SECONDS
    );
  } catch {
    // Best effort only.
  }
  return weights;
}

async function computeSocialProofWeights(
  viewerId: string,
  candidatePostIds: string[],
  now: Date
): Promise<Map<string, number>> {
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
    embeddingModel?: string | null;
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
    embeddingModel: post.embeddingModel,
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
    prisma.orm.public.RecommendationEvents.select(
      "createdAt",
      "eventType",
      "durationMs"
    )
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
    if (
      (event.eventType === "DWELL" && (event.durationMs ?? 0) < 1000) ||
      (event.eventType === "SKIP" && (event.durationMs ?? 0) > 3000)
    ) {
      continue;
    }
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
    ...buildUserProfile(signals, {
      knowledgeGraph:
        (await loadSharedTopicGraph(
          signals.flatMap((signal) => signal.tags)
        ).catch(() => {
          /* empty */
        })) ?? undefined,
    }),
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

export async function getRecommendationProfile(
  userId: string
): Promise<CachedProfile> {
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
    await Promise.all([
      redis.del(fypProfileKey(userId)),
      redis.set(
        `rec:suggestions:version:${userId}`,
        crypto.randomUUID(),
        "EX",
        30 * 24 * 60 * 60
      ),
    ]);
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
    offset = Math.max(0, Math.min(rawOffset, 1200));
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
  const { networkProfile } = options;
  const visibilityPredicate = communityVisibilityWhere(userId);
  const [profile, viewerSession, blocks] = await Promise.all([
    networkProfile
      ? fetchFollowedAuthorIds(userId).then((followedAuthorIds) => ({
          ...networkProfile,
          followedAuthorIds,
        }))
      : getRecommendationProfile(userId),
    prisma.orm.public.Sessions.select("country")
      .where({ userId })
      .orderBy((session) => session.updatedAt.desc())
      .first(),
    prisma.orm.public.Blocks.select("blockerId", "blockedId")
      .where((block) =>
        or(block.blockerId.eq(userId), block.blockedId.eq(userId))
      )
      .all(),
  ]);
  const candidateQuery = () =>
    prisma.orm.public.Posts.select(
      "aura",
      "createdAt",
      "embedding",
      "embeddingModel",
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
        media.select("id", "duplicateOf", "_type", "ocrText", "transcript")
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
          ...(blocks.length
            ? [
                post.userId.notIn(
                  blocks.map((block) =>
                    block.blockerId === userId
                      ? block.blockedId
                      : block.blockerId
                  )
                ),
              ]
            : []),
        ];
        if (options.excludeExplicit) {
          predicates.push(post.explicitContent.eq(false));
        }
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
      });
  const snapshotKey = `rec:fyp:v3:${rankingAssignment(userId).variant}:${userId}:${contentKind}:${timestamp}:${excludeModerated}:${Boolean(options.excludeExplicit)}:${includeVisited}:${options.networkScope ?? "legacy"}`;
  if (cursor) {
    const cached = await redis.get(snapshotKey).catch(() => null);
    if (cached) {
      try {
        const snapshot: unknown = JSON.parse(cached);
        if (
          snapshot &&
          typeof snapshot === "object" &&
          "ids" in snapshot &&
          Array.isArray(snapshot.ids) &&
          snapshot.ids.length <= 1200 &&
          snapshot.ids.every((id) => typeof id === "string") &&
          "anchor" in snapshot &&
          typeof snapshot.anchor === "string"
        ) {
          const ids: string[] = snapshot.ids;
          const visible = await candidateQuery()
            .where((post) => post.id.in(ids.slice(offset)))
            .limit(1200)
            .all();
          const eligible = new Set(visible.map((post) => post.id));
          const remaining = ids.slice(offset).filter((id) => eligible.has(id));
          const pageIds = remaining.slice(0, pageSize);
          const rows = await getPostDataQuery(prisma.orm, userId)
            .where((post) => post.id.in(pageIds))
            .all();
          const byId = new Map(
            rows.map((post) => [post.id, mapPostData(post)])
          );
          const last = pageIds.at(-1);
          const nextOffset = last ? ids.indexOf(last) + 1 : ids.length;
          return {
            anchorCursor: snapshot.anchor,
            nextCursor:
              nextOffset < ids.length
                ? `fyp.${contentKind}.${nextOffset}.${timestamp}`
                : `exp.${snapshot.anchor}`,
            posts: await attributeFeedPage(
              userId,
              pageIds.flatMap((id) => {
                const post = byId.get(id);
                return post ? [post] : [];
              }),
              new Map(
                "sources" in snapshot && Array.isArray(snapshot.sources)
                  ? snapshot.sources.filter(
                      (entry): entry is [string, string[]] =>
                        Array.isArray(entry) &&
                        typeof entry[0] === "string" &&
                        Array.isArray(entry[1]) &&
                        entry[1].every(
                          (source: unknown) => typeof source === "string"
                        )
                    )
                  : []
              ),
              offset
            ),
          };
        }
      } catch (error) {
        logger.warn({ error }, "ranked snapshot unavailable; rebuilding");
      }
    }
  }
  const semanticIds = await retrieveSemanticCandidates(
    profile.embeddingModel,
    profile.tasteVector
  ).catch(() => []);
  const topTags = Object.entries({
    ...profile.tagWeights,
    ...profile.sessionTagWeights,
  })
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);
  const topicResult = topTags.length
    ? await rawQuery<{ id: string }>(
        retrieval.topics,
        [topTags, contentKind === "gust"],
        { id: "pg/text@1" }
      )
    : { rows: [] };
  const topicIds = topicResult.rows.map((row) => row.id);
  const collaborativeResult = await rawQuery<{ id: string }>(
    retrieval.collaborative,
    [userId],
    { id: "pg/text@1" }
  );
  const collaborativeIds = collaborativeResult.rows.map((row) => row.id);
  const [recent, followed, semantic, topical, exploration, collaborative] =
    await Promise.all([
      candidateQuery()
        .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()])
        .limit(CANDIDATE_POOL_SIZE)
        .all(),
      profile.followedAuthorIds.length
        ? candidateQuery()
            .where((post) => post.userId.in(profile.followedAuthorIds))
            .orderBy((post) => post.createdAt.desc())
            .limit(100)
            .all()
        : [],
      semanticIds.length
        ? candidateQuery()
            .where((post) => post.id.in(semanticIds))
            .limit(200)
            .all()
        : [],
      topicIds.length
        ? candidateQuery()
            .where((post) => post.id.in(topicIds))
            .limit(150)
            .all()
        : [],
      candidateQuery()
        .orderBy([(post) => post.trendingScore.desc(), (post) => post.id.asc()])
        .limit(50)
        .all(),
      collaborativeIds.length
        ? candidateQuery()
            .where((post) => post.id.in(collaborativeIds))
            .limit(100)
            .all()
        : [],
    ]);
  const candidateSources = new Map<string, string[]>();
  for (const [source, candidates] of Object.entries({
    collaborative,
    exploration,
    followed,
    recent,
    semantic,
    topical,
  })) {
    for (const post of candidates) {
      candidateSources.set(post.id, [
        ...(candidateSources.get(post.id) ?? []),
        source,
      ]);
    }
  }
  const pool = [
    ...new Map(
      [
        ...recent,
        ...followed,
        ...semantic,
        ...topical,
        ...exploration,
        ...collaborative,
      ].map((post) => [post.id, post])
    ).values(),
  ];

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
      embeddingModel: post.embeddingModel,
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
      mediaKeys: attachments.map(
        (attachment) => attachment.duplicateOf ?? attachment.id
      ),
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

  const ranked: CandidatePost[] = [];
  let remaining = scored;
  while (remaining.length) {
    const page = rankFeed(remaining, {
      maxSingleTopicShare:
        rankingAssignment(userId).variant === "balanced" ? 0.45 : 0.6,
      pageSize,
    });
    if (!page.length) {
      break;
    }
    ranked.push(...page);
    const chosen = new Set(page.map((post) => post.id));
    remaining = remaining.filter((item) => !chosen.has(item.post.id));
  }
  if (!cursor) {
    await redis
      .set(
        snapshotKey,
        JSON.stringify({
          anchor: recent.at(-1)?.id ?? "",
          ids: ranked.map((post) => post.id),
          sources: [...candidateSources],
        }),
        "EX",
        1800
      )
      .catch(() => null);
  }
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
      retrievalSources: {
        collaborative: collaborative.length,
        exploration: exploration.length,
        followed: followed.length,
        recent: recent.length,
        semantic: semantic.length,
        topical: topical.length,
      },
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
    nextCursor = `exp.${recent.at(-1)?.id ?? ""}`;
  }

  return {
    anchorCursor: recent.at(-1)?.id ?? null,
    nextCursor,
    posts: await attributeFeedPage(
      userId,
      orderedPosts,
      candidateSources,
      offset
    ),
  };
}
