"use server";

import { prisma } from "@asm/db";

import { getTrendingTopics } from "./topic-actions";

export interface TrendingMention {
  avatarUrl: string | null;
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

export type TrendingItem = TrendingHashtag | TrendingMention;

async function getTopMentionedUsers(): Promise<TrendingMention[]> {
  try {
    const grouped = await prisma.mention.groupBy({
      _count: { _all: true },
      by: ["userId"],
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    });

    if (grouped.length === 0) {
      return [];
    }

    const users = await prisma.user.findMany({
      select: {
        avatarUrl: true,
        displayName: true,
        id: true,
        username: true,
      },
      where: { id: { in: grouped.map((g) => g.userId) } },
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

export async function getTrendingFeed(
  bypassCache = false
): Promise<TrendingItem[]> {
  const [topics, mentions] = await Promise.all([
    getTrendingTopics(bypassCache),
    getTopMentionedUsers(),
  ]);

  const hashtags: TrendingHashtag[] = topics
    .slice(0, 5)
    .map(({ hashtag, count }) => ({ count, hashtag, type: "hashtag" }));

  return [...hashtags, ...mentions]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);
}
