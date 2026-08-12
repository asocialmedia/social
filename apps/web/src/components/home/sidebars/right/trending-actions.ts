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
      by: ["userId"],
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    });

    if (grouped.length === 0) {
      return [];
    }

    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
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
          type: "mention" as const,
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          count: group._count._all,
        };
      })
      .filter((item): item is TrendingMention => item !== null)
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error("Error fetching top mentioned users:", error);
    return [];
  }
}

export async function getTrendingFeed(): Promise<TrendingItem[]> {
  const [topics, mentions] = await Promise.all([
    getTrendingTopics(),
    getTopMentionedUsers(),
  ]);

  const hashtags: TrendingHashtag[] = topics
    .slice(0, 5)
    .map(({ hashtag, count }) => ({ type: "hashtag", hashtag, count }));

  return [...hashtags, ...mentions]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
