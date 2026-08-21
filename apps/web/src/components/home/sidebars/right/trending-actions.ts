"use server";

import { prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";

import { getTrendingTopics } from "./topic-actions";
import { selectTopAuraUsers } from "./trending-utils";

export interface TrendingMention {
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
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

export interface TrendingAuraUser {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  displayName: string | null;
  type: "aura";
  userId: string;
  username: string;
}

export type TrendingItem = TrendingHashtag | TrendingMention;

export interface TrendingFeed {
  items: TrendingItem[];
  topAura: TrendingAuraUser[];
}

async function getTopMentionedUsers(): Promise<TrendingMention[]> {
  try {
    const grouped = await prisma.mention.groupBy({
      _count: { _all: true },
      by: ["userId"],
      orderBy: { _count: { userId: "desc" } },
      take: 5,
      where: { userId: { not: SYSTEM_MODERATION_USER_ID } },
    });

    if (grouped.length === 0) {
      return [];
    }

    const users = await prisma.user.findMany({
      select: {
        avatarUrl: true,
        badge: true,
        badges: true,
        displayName: true,
        id: true,
        username: true,
      },
      where: {
        NOT: { id: SYSTEM_MODERATION_USER_ID },
        id: { in: grouped.map((g) => g.userId) },
      },
    });

    const userById = new Map(users.map((user) => [user.id, user]));

    return grouped
      .map((group) => {
        const user = userById.get(group.userId);
        if (!user) {
          return null;
        }
        return {
          avatarUrl: user.avatarUrl,
          badge: user.badge,
          badges: user.badges,
          count: group._count._all,
          displayName: user.displayName,
          type: "mention" as const,
          userId: user.id,
          username: user.username,
        };
      })
      .filter((item): item is TrendingMention => item !== null)
      .toSorted((a, b) => b.count - a.count);
  } catch (error) {
    console.error("Error fetching top mentioned users:", error);
    return [];
  }
}

// Fetch extra candidates so dedupe against the mentioned list can still fill
// the Top Aura section to three entries.
const TOP_AURA_CANDIDATES = 10;

async function getTopAuraUsers(): Promise<TrendingAuraUser[]> {
  try {
    const users = await prisma.user.findMany({
      orderBy: { aura: "desc" },
      select: {
        aura: true,
        avatarUrl: true,
        badge: true,
        badges: true,
        displayName: true,
        id: true,
        username: true,
      },
      take: TOP_AURA_CANDIDATES,
      where: { id: { not: SYSTEM_MODERATION_USER_ID } },
    });

    return users.map((user) => ({
      aura: user.aura,
      avatarUrl: user.avatarUrl,
      badge: user.badge,
      badges: user.badges,
      displayName: user.displayName,
      type: "aura" as const,
      userId: user.id,
      username: user.username,
    }));
  } catch (error) {
    console.error("Error fetching top aura users:", error);
    return [];
  }
}

export async function getTrendingFeed(
  bypassCache = false
): Promise<TrendingFeed> {
  const [topics, mentions, topAura] = await Promise.all([
    getTrendingTopics(bypassCache),
    getTopMentionedUsers(),
    getTopAuraUsers(),
  ]);

  const hashtags: TrendingHashtag[] = topics
    .slice(0, 5)
    .map(({ hashtag, count }) => ({ count, hashtag, type: "hashtag" }));

  const items = [...hashtags, ...mentions]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);

  // A user who is already listed among the top mentioned users doesn't need a
  // second entry in the Top Aura section, so skip them and backfill from the
  // extra candidates.
  return { items, topAura: selectTopAuraUsers(topAura, mentions) };
}
