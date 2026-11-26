"use server";

import {
  and,
  getUserDataQuery,
  mapUserData,
  prisma,
  redis,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";
import type { CommunityRoleRow } from "@asm/db";
import {
  abortable,
  readJsonBounded,
  retryAfterMs,
} from "@asm/protocols/discovery";

import { getWebLogger } from "@/lib/otel";

import { getTrendingTopics } from "./topic-actions";
import { selectTopAuraUsers, weaveTrendingItems } from "./trending-utils";

export interface TrendingMention {
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  communityMemberships: CommunityRoleRow[];
  count: number;
  displayName: string;
  type: "mention";
  userId: string;
  username: string;
}

export interface TrendingHashtag {
  count: number;
  hashtag: string;
  type: "hashtag";
}

export interface TrendingBlueskyTopic {
  description?: string;
  displayName: string;
  link?: string;
  source: "bluesky";
  topic: string;
  type: "bluesky_topic";
  matchedInterests?: string[];
}

export interface TrendingAuraUser {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  communityMemberships: CommunityRoleRow[];
  displayName: string | null;
  type: "aura";
  userId: string;
  username: string;
}

export type TrendingItem =
  | TrendingHashtag
  | TrendingMention
  | TrendingBlueskyTopic;

export interface TrendingFeed {
  items: TrendingItem[];
  topAura: TrendingAuraUser[];
  unavailable: ("hashtags" | "mentions" | "bluesky" | "aura")[];
}

const BLUESKY_TRENDING_KEY = "trending:bluesky:topics:v3";
const BLUESKY_TRENDING_FRESH_MS = 5 * 60_000;
const BLUESKY_TRENDING_RETENTION_SECONDS = 60 * 60;
interface BlueskyTrendingSnapshot {
  at: number;
  topics: TrendingBlueskyTopic[];
}
let localBlueskyTrending: BlueskyTrendingSnapshot | undefined;
let pendingBlueskyTrending: Promise<TrendingBlueskyTopic[]> | undefined;
let blueskyTrendingRetryAt = 0;

export async function fetchBlueskyTrendingTopics(
  bypassCache = false
): Promise<TrendingBlueskyTopic[]> {
  const now = Date.now();
  let snapshot = localBlueskyTrending;
  if (
    snapshot &&
    now - snapshot.at < BLUESKY_TRENDING_FRESH_MS &&
    !bypassCache
  ) {
    return snapshot.topics;
  }
  try {
    const cached = await abortable(
      redis.get(BLUESKY_TRENDING_KEY),
      AbortSignal.timeout(150)
    );
    if (cached) {
      const shared = JSON.parse(cached) as BlueskyTrendingSnapshot | null;
      if (
        shared &&
        Number.isFinite(shared.at) &&
        shared.at <= now + 5000 &&
        Array.isArray(shared.topics) &&
        (!snapshot || shared.at >= snapshot.at)
      ) {
        snapshot = shared;
        localBlueskyTrending = shared;
      }
    }
  } catch {
    // Public trends can still be read while Redis recovers.
  }
  if (
    snapshot &&
    now - snapshot.at >= BLUESKY_TRENDING_RETENTION_SECONDS * 1000
  ) {
    snapshot = undefined;
  }
  if (
    snapshot &&
    now - snapshot.at < BLUESKY_TRENDING_FRESH_MS &&
    !bypassCache
  ) {
    return snapshot.topics;
  }
  if (now < blueskyTrendingRetryAt) {
    if (snapshot) {
      return snapshot.topics;
    }
    throw new Error("Bluesky trending is temporarily unavailable");
  }
  pendingBlueskyTrending ??= refreshBlueskyTrending();
  const read = pendingBlueskyTrending;
  if (snapshot && !bypassCache) {
    // oxlint-disable-next-line promise/prefer-await-to-then -- The refresh runs after the cached response can return.
    void settleBlueskyTrending(read).catch(() => {
      /* empty */
    });
    return snapshot.topics;
  }
  try {
    return await settleBlueskyTrending(read);
  } catch (error) {
    if (snapshot) {
      return snapshot.topics;
    }
    throw error;
  }
}

async function settleBlueskyTrending(read: Promise<TrendingBlueskyTopic[]>) {
  try {
    return await read;
  } finally {
    if (pendingBlueskyTrending === read) {
      pendingBlueskyTrending = undefined;
    }
  }
}

async function refreshBlueskyTrending(): Promise<TrendingBlueskyTopic[]> {
  try {
    const signal = AbortSignal.timeout(1800);
    const res = await fetch(
      "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics",
      {
        headers: { Accept: "application/json" },
        signal,
      }
    );

    if (!res.ok) {
      blueskyTrendingRetryAt =
        Date.now() + (retryAfterMs(res.headers.get("retry-after")) ?? 10_000);
      await res.body?.cancel();
      throw new Error(
        `Bluesky trending topics endpoint returned ${res.status}`
      );
    }

    const data = (await readJsonBounded(res, 128 * 1024, signal)) as {
      topics?: {
        description?: string;
        displayName?: string;
        link?: string;
        topic: string;
      }[];
    };

    if (!Array.isArray(data?.topics)) {
      throw new TypeError("Bluesky returned invalid trending topics");
    }
    const rawTopics = data.topics;
    const topics: TrendingBlueskyTopic[] = rawTopics
      .filter((t) => typeof t?.topic === "string" && t.topic.trim().length > 0)
      .slice(0, 20)
      .map((t) => ({
        description: t.description?.trim() || undefined,
        displayName: t.displayName?.trim() || t.topic.trim(),
        link: t.link?.trim() || undefined,
        source: "bluesky",
        topic: t.topic.trim(),
        type: "bluesky_topic",
      }));

    const snapshot = { at: Date.now(), topics };
    localBlueskyTrending = snapshot;
    try {
      await abortable(
        redis.set(
          BLUESKY_TRENDING_KEY,
          JSON.stringify(snapshot),
          "EX",
          BLUESKY_TRENDING_RETENTION_SECONDS
        ),
        AbortSignal.timeout(150)
      );
    } catch {
      getWebLogger()?.warn(
        { dependency: "redis", operation: "trending.snapshot.write" },
        "Bluesky trending snapshot could not be shared"
      );
    }

    return topics;
  } catch (error) {
    blueskyTrendingRetryAt = Math.max(
      blueskyTrendingRetryAt,
      Date.now() + 10_000
    );
    getWebLogger()?.warn(
      {
        dependency: "bluesky",
        operation: "trending.refresh",
        timeout: error instanceof Error && error.name === "TimeoutError",
      },
      "Bluesky trending refresh unavailable"
    );
    throw error;
  }
}

async function getTopMentionedUsers(): Promise<TrendingMention[]> {
  try {
    const grouped = await prisma.orm.public.Mentions.where((mention) =>
      mention.userId.notIn([SYSTEM_MODERATION_USER_ID])
    )
      .groupBy("userId")
      .aggregate((aggregate) => ({ count: aggregate.count() }));
    const topGrouped = [...grouped]
      .toSorted((left, right) => right.count - left.count)
      .slice(0, 5);

    if (topGrouped.length === 0) {
      return [];
    }

    const users = await getUserDataQuery(prisma.orm, "")
      .where((user) =>
        and(
          user.id.notIn([SYSTEM_MODERATION_USER_ID]),
          user.id.in(topGrouped.map((group) => group.userId))
        )
      )
      .all()
      .then((rows) => rows.map(mapUserData));

    const userById = new Map(users.map((user) => [user.id, user]));

    return (
      topGrouped
        // Annotated so the Prisma enum on `role` widens to the DTO's `string`;
        // without it the type predicate below cannot narrow the mapped array.
        .map((group): TrendingMention | null => {
          const user = userById.get(group.userId);
          if (!user) {
            return null;
          }
          return {
            avatarUrl: user.avatarUrl,
            badge: user.badge,
            badges: [...(user.badges ?? [])],
            communityMemberships: user.communityMemberships,
            count: group.count,
            displayName: user.displayName,
            type: "mention",
            userId: user.id,
            username: user.username,
          };
        })
        .filter((item): item is TrendingMention => item !== null)
        .toSorted((a, b) => b.count - a.count)
    );
  } catch (error) {
    console.error("Error fetching top mentioned users:", error);
    throw error;
  }
}

// Fetch extra candidates so dedupe against the mentioned list can still fill
// the Top Aura section to three entries.
const TOP_AURA_CANDIDATES = 10;

async function getTopAuraUsers(): Promise<TrendingAuraUser[]> {
  try {
    const users = await getUserDataQuery(prisma.orm, "")
      .where((user) =>
        and(user.banned.eq(false), user.id.notIn([SYSTEM_MODERATION_USER_ID]))
      )
      .orderBy((user) => user.aura.desc())
      .limit(TOP_AURA_CANDIDATES)
      .all()
      .then((rows) => rows.map(mapUserData));

    return users.map((user) => ({
      aura: user.aura,
      avatarUrl: user.avatarUrl,
      badge: user.badge,
      badges: [...(user.badges ?? [])],
      communityMemberships: user.communityMemberships,
      displayName: user.displayName,
      type: "aura" as const,
      userId: user.id,
      username: user.username,
    }));
  } catch (error) {
    console.error("Error fetching top aura users:", error);
    throw error;
  }
}

export async function getTrendingFeed(
  bypassCache = false,
  includeBluesky = true
): Promise<TrendingFeed> {
  const signal = AbortSignal.timeout(2500);
  const results = await Promise.allSettled([
    abortable(getTrendingTopics(bypassCache), signal),
    abortable(getTopMentionedUsers(), signal),
    abortable(getTopAuraUsers(), signal),
    includeBluesky
      ? abortable(fetchBlueskyTrendingTopics(bypassCache), signal)
      : Promise.resolve([]),
  ]);

  const [topicResult, mentionResult, auraResult, blueskyResult] = results;
  const unavailable: TrendingFeed["unavailable"] = [];
  for (const [index, source] of (
    ["hashtags", "mentions", "aura", "bluesky"] as const
  ).entries()) {
    if (results[index].status === "rejected") {
      unavailable.push(source);
    }
  }
  if (
    unavailable.length ===
    (includeBluesky ? results.length : results.length - 1)
  ) {
    throw new Error("Trending sources are unavailable");
  }
  const topics = topicResult.status === "fulfilled" ? topicResult.value : [];
  const mentions =
    mentionResult.status === "fulfilled" ? mentionResult.value : [];
  const topAura = auraResult.status === "fulfilled" ? auraResult.value : [];
  const blueskyTopics =
    blueskyResult.status === "fulfilled" ? blueskyResult.value : [];
  const hashtags: TrendingHashtag[] = topics
    .slice(0, 5)
    .map(({ hashtag, count }) => ({ count, hashtag, type: "hashtag" }));

  const asmItems = [...hashtags, ...mentions]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);

  const items = weaveTrendingItems(asmItems, blueskyTopics, 30);

  // Top Aura displays the platform's highest aura earners regardless of
  // mentions, ensuring high-standing members are always recognized.
  return { items, topAura: selectTopAuraUsers(topAura, mentions), unavailable };
}
