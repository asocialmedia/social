import { describe, expect, test } from "bun:test";

import { selectTopAuraUsers, weaveTrendingItems } from "./trending-utils";
import type {
  TrendingAuraUser,
  TrendingBlueskyTopic,
  TrendingHashtag,
  TrendingItem,
  TrendingMention,
} from "./trending-utils";

const auraUser = (
  id: string,
  aura: number,
  badges: string[] = []
): TrendingAuraUser => ({
  aura,
  avatarUrl: null,
  badge: badges[0] ?? null,
  badges,
  communityMemberships: [],
  displayName: `User ${id}`,
  type: "aura",
  userId: id,
  username: id,
});

const mention = (
  userId: string,
  count = 5,
  badges: string[] = []
): TrendingMention => ({
  avatarUrl: null,
  badge: badges[0] ?? null,
  badges,
  communityMemberships: [],
  count,
  displayName: `User ${userId}`,
  type: "mention",
  userId,
  username: userId,
});

const hashtag = (tag: string, count = 10): TrendingHashtag => ({
  count,
  hashtag: `#${tag}`,
  type: "hashtag",
});

const bskyTopic = (
  topic: string,
  displayName = topic,
  description?: string
): TrendingBlueskyTopic => ({
  description,
  displayName,
  link: `/search?q=${encodeURIComponent(topic)}`,
  source: "bluesky",
  topic,
  type: "bluesky_topic",
});

function getTestItemIdentifier(item: TrendingItem): string {
  if (item.type === "bluesky_topic") {
    return item.topic;
  }
  if (item.type === "hashtag") {
    return item.hashtag;
  }
  return item.username;
}

describe("selectTopAuraUsers", () => {
  test("returns the top three by aura", () => {
    const topAura = [
      auraUser("a", 300),
      auraUser("b", 200),
      auraUser("c", 100),
      auraUser("d", 50),
    ];

    const result = selectTopAuraUsers(topAura);

    expect(result.map((user) => user.userId)).toEqual(["a", "b", "c"]);
  });

  test("preserves non-null badges like dev and author on selected users", () => {
    const topAura = [
      auraUser("a", 300, ["dev"]),
      auraUser("b", 200, ["author"]),
      auraUser("c", 100, []),
    ];

    const result = selectTopAuraUsers(topAura, []);

    expect(result.map((user) => user.badges)).toEqual([
      ["dev"],
      ["author"],
      [],
    ]);
  });

  test("retains top aura users even if they also appear in mentions", () => {
    const topAura = [
      auraUser("a", 300),
      auraUser("b", 200),
      auraUser("c", 100),
      auraUser("d", 50),
      auraUser("e", 10),
    ];

    const result = selectTopAuraUsers(topAura, [mention("a"), mention("b")]);

    expect(result.map((user) => user.userId)).toEqual(["a", "b", "c"]);
  });

  test("returns what remains when candidates run out", () => {
    const topAura = [auraUser("a", 300), auraUser("b", 200)];

    const result = selectTopAuraUsers(topAura, []);

    expect(result.map((user) => user.userId)).toEqual(["a", "b"]);
  });
});

describe("weaveTrendingItems", () => {
  test("interleaves Bluesky topics into ASM items without displacing top ASM items", () => {
    const asmItems = [
      hashtag("nextjs", 50),
      hashtag("react", 40),
      mention("alice", 30),
      hashtag("typescript", 20),
      mention("bob", 10),
    ];
    const bsky = [bskyTopic("caturday"), bskyTopic("ai-safety")];

    const result = weaveTrendingItems(asmItems, bsky, 7);

    // Indices 0 and 1 are top ASM items
    expect(result[0]).toEqual(asmItems[0]);
    expect(result[1]).toEqual(asmItems[1]);
    // Index 2 is the first Bluesky topic
    expect(result[2]).toEqual(bsky[0]);
    // Indices 3 and 4 are the next ASM items
    expect(result[3]).toEqual(asmItems[2]);
    expect(result[4]).toEqual(asmItems[3]);
    // Index 5 is the second Bluesky topic
    expect(result[5]).toEqual(bsky[1]);
    // Index 6 is the fifth ASM item
    expect(result[6]).toEqual(asmItems[4]);
    expect(result.length).toBe(7);
  });

  test("returns only ASM items when no Bluesky topics are available", () => {
    const asmItems = [hashtag("solo", 10), mention("carol", 5)];

    const result = weaveTrendingItems(asmItems, [], 7);

    expect(result).toEqual(asmItems);
  });

  test("returns Bluesky topics when ASM has no trending topics yet", () => {
    const bsky = [bskyTopic("topic1"), bskyTopic("topic2")];

    const result = weaveTrendingItems([], bsky, 7);

    expect(result).toEqual(bsky);
  });

  test("respects maxItems limit when both sets are large", () => {
    const asmItems = [
      hashtag("1"),
      hashtag("2"),
      hashtag("3"),
      hashtag("4"),
      hashtag("5"),
      hashtag("6"),
    ];
    const bsky = [
      bskyTopic("b1"),
      bskyTopic("b2"),
      bskyTopic("b3"),
      bskyTopic("b4"),
    ];

    const result = weaveTrendingItems(asmItems, bsky, 5);

    expect(result.length).toBe(5);
    expect(result.map(getTestItemIdentifier)).toEqual([
      "#1",
      "#2",
      "b1",
      "#3",
      "#4",
    ]);
  });
});
