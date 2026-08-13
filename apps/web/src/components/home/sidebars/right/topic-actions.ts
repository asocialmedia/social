"use server";

import { prisma, type TrendingTopic, trendingTopicsCache } from "@asm/db";

async function getTrendingTopicsFromDb(): Promise<TrendingTopic[]> {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: { posts: { _count: "desc" } },
      select: {
        name: true,
        _count: { select: { posts: true } },
      },
      take: 10,
    });

    return tags
      .filter((tag) => tag._count.posts > 0)
      .map((tag) => ({
        hashtag: `#${tag.name}`,
        count: tag._count.posts,
      }));
  } catch (error) {
    console.error("Error executing trending topics query:", error);
    return [];
  }
}

trendingTopicsCache.refreshCache = async function (): Promise<TrendingTopic[]> {
  const topics = await getTrendingTopicsFromDb();
  await this.set(topics);
  return topics;
};

export async function invalidateTrendingTopicsCache(): Promise<
  TrendingTopic[]
> {
  try {
    const newTopics = await getTrendingTopicsFromDb();
    if (newTopics.length === 0) {
      throw new Error("No new topics found");
    }

    await trendingTopicsCache.set(newTopics);
    return newTopics;
  } catch (error) {
    console.error("Error in invalidateTrendingTopicsCache:", error);
    return getTrendingTopics();
  }
}

export async function getTrendingTopics(
  bypassCache = false
): Promise<TrendingTopic[]> {
  try {
    if (bypassCache) {
      const newTopics = await getTrendingTopicsFromDb();
      if (newTopics.length > 0) {
        await trendingTopicsCache.set(newTopics);
      }
      return newTopics;
    }

    const cachedTopics = await trendingTopicsCache.get();

    if (cachedTopics.length > 0) {
      if (await trendingTopicsCache.shouldRefresh()) {
        backgroundRefreshTopics();
      }
      return cachedTopics;
    }

    const newTopics = await getTrendingTopicsFromDb();
    if (newTopics.length > 0) {
      await trendingTopicsCache.set(newTopics);
      return newTopics;
    }

    return [];
  } catch (error) {
    console.error("Error in getTrendingTopics:", error);
    return getTrendingTopicsFromDb();
  }
}

export async function backgroundRefreshTopics(): Promise<void> {
  try {
    const topics = await getTrendingTopicsFromDb();
    if (topics.length > 0) {
      await trendingTopicsCache.set(topics);
    }
  } catch (error) {
    console.error("Error in background refresh:", error);
  }
}
