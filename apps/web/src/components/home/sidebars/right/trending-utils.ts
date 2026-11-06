import {
  matchesAvoidedTopic,
  networkInterestScore,
} from "@asm/protocols/discovery";
import type { NetworkTopicScope } from "@asm/protocols/discovery";

import type {
  TrendingAuraUser,
  TrendingFeed,
  TrendingBlueskyTopic,
  TrendingHashtag,
  TrendingItem,
  TrendingMention,
} from "./trending-actions";

export type {
  TrendingAuraUser,
  TrendingBlueskyTopic,
  TrendingHashtag,
  TrendingItem,
  TrendingMention,
} from "./trending-actions";

export function filterTrendingForInterests(
  items: TrendingItem[],
  interests: readonly string[],
  avoided: readonly string[],
  scope?: NetworkTopicScope
): TrendingItem[] {
  return items.filter((item) => {
    let text: string;
    if (item.type === "hashtag") {
      text = item.hashtag;
    } else if (item.type === "bluesky_topic") {
      text = `${item.topic} ${item.displayName} ${item.description ?? ""}`;
    } else {
      text = `${item.displayName} ${item.username}`;
    }
    return (
      !matchesAvoidedTopic(text, [text], avoided) &&
      (!interests.length ||
        networkInterestScore(
          text,
          [
            text,
            ...(item.type === "bluesky_topic"
              ? (item.matchedInterests ?? [])
              : []),
          ],
          interests,
          scope
        ) > 0)
    );
  });
}

// Picks the top aura users to show in the Trending card. Always preserves
// the highest aura members so the leaderboard accurately reflects top
// standing rather than excluding them when they also receive mentions.
//
// Lives outside trending-actions.ts because that module is a "use server"
// action file, where every export must be an async server action.
export function selectTopAuraUsers(
  topAura: TrendingAuraUser[],
  _mentions?: TrendingMention[]
): TrendingAuraUser[] {
  return topAura.slice(0, 3);
}

// Sneaks Bluesky trending topics into the trending list without disturbing
// the relative order of existing ASM trending items (hashtags and mentions).
// Places up to 2 ASM items before introducing a Bluesky item, repeating until
// the items limit is satisfied.
export function weaveTrendingItems(
  asmItems: (TrendingHashtag | TrendingMention)[],
  blueskyTopics: TrendingBlueskyTopic[],
  maxItems = 7
): TrendingItem[] {
  if (blueskyTopics.length === 0) {
    return asmItems.slice(0, maxItems);
  }
  if (asmItems.length === 0) {
    return blueskyTopics.slice(0, maxItems);
  }

  const result: TrendingItem[] = [];
  let asmIndex = 0;
  let bskyIndex = 0;

  while (
    result.length < maxItems &&
    (asmIndex < asmItems.length || bskyIndex < blueskyTopics.length)
  ) {
    for (
      let i = 0;
      i < 2 && asmIndex < asmItems.length && result.length < maxItems;
      i += 1
    ) {
      const nextAsm = asmItems[asmIndex];
      asmIndex += 1;
      if (nextAsm) {
        result.push(nextAsm);
      }
    }
    if (bskyIndex < blueskyTopics.length && result.length < maxItems) {
      const nextBsky = blueskyTopics[bskyIndex];
      bskyIndex += 1;
      if (nextBsky) {
        result.push(nextBsky);
      }
    }
    if (asmIndex >= asmItems.length) {
      while (bskyIndex < blueskyTopics.length && result.length < maxItems) {
        const remainingBsky = blueskyTopics[bskyIndex];
        bskyIndex += 1;
        if (remainingBsky) {
          result.push(remainingBsky);
        }
      }
      break;
    }
  }

  return result;
}

function sourceOf(item: TrendingItem) {
  if (item.type === "hashtag") {
    return "hashtags";
  }
  return item.type === "mention" ? "mentions" : "bluesky";
}

export function mergeTrendingFeed(
  previous: TrendingFeed | undefined,
  fresh: TrendingFeed
): TrendingFeed {
  if (!previous || !fresh.unavailable.length) {
    return fresh;
  }
  const retained = previous.items.filter((item) =>
    fresh.unavailable.includes(sourceOf(item))
  );
  const seen = new Set<string>();
  const items = [...fresh.items, ...retained].filter((item) => {
    let id: string;
    if (item.type === "hashtag") {
      id = item.hashtag;
    } else if (item.type === "mention") {
      id = item.userId;
    } else {
      id = item.topic;
    }
    const key = `${item.type}:${id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    ...fresh,
    items: weaveTrendingItems(
      items.filter((item) => item.type !== "bluesky_topic"),
      items.filter((item) => item.type === "bluesky_topic"),
      30
    ),
    topAura: fresh.unavailable.includes("aura")
      ? previous.topAura
      : fresh.topAura,
  };
}
