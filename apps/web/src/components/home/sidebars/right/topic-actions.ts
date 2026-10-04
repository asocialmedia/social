"use server";

import { prisma, trendingTopicsCache } from "@asm/db";
import type { TrendingTopic } from "@asm/db";

// The sidebar renders ten topics. Pushing the cut into SQL keeps the query
// bounded no matter how many tags the table accumulates.
const TRENDING_TOPIC_LIMIT = 10;

async function getTrendingTopicsFromDb(): Promise<TrendingTopic[]> {
  try {
    // Count the join table instead of every tag.
    //
    // The previous shape selected the whole Tag table and ran a correlated
    // count per row, then filtered, sorted and cut to ten on the client. With
    // no WHERE and no LIMIT it held a pooled connection for as long as the scan
    // ran, and the pg driver sets no statement_timeout, so nothing reclaimed
    // the slot. Ten of those exhausted the pool and every other query in the
    // process queued behind them until the 5s checkout deadline fired
    // ("timeout exceeded when trying to connect").
    //
    // Grouping the join table on its indexed tag column collapses the work to
    // one aggregate over distinct tags, and the name lookup is bounded to the
    // rows that actually reach the sidebar.
    const grouped = await prisma.orm.public.PostToTag.groupBy("b").aggregate(
      (aggregate) => ({ count: aggregate.count() })
    );

    const topTags = [...grouped]
      .toSorted((left, right) => right.count - left.count)
      .slice(0, TRENDING_TOPIC_LIMIT);

    if (topTags.length === 0) {
      return [];
    }

    const countsByTagId = new Map(
      topTags.map((group) => [group.b, group.count])
    );

    const tags = await prisma.orm.public.Tag.select("id", "name")
      .where((tag) => tag.id.in(topTags.map((group) => group.b)))
      .all();

    return tags
      .map((tag) => ({
        count: countsByTagId.get(tag.id) ?? 0,
        hashtag: `#${tag.name}`,
      }))
      .toSorted((left, right) => right.count - left.count);
  } catch (error) {
    console.error("Error executing trending topics query:", error);
    return [];
  }
}

trendingTopicsCache.refreshCache = async function refreshCache(): Promise<
  TrendingTopic[]
> {
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
