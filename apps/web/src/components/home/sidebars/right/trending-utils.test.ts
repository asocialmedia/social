import { expect, test } from "bun:test";

import {
  filterTrendingForInterests,
  weaveTrendingItems,
} from "./trending-utils";
import type { TrendingItem } from "./trending-utils";

test("global Bluesky news cannot leak into the Trending sidebar of an unrelated persona", () => {
  const items: TrendingItem[] = [
    {
      displayName: "Election headlines",
      source: "bluesky",
      topic: "election",
      type: "bluesky_topic",
    },
    {
      displayName: "TypeScript release",
      source: "bluesky",
      topic: "typescript",
      type: "bluesky_topic",
    },
    { count: 20, hashtag: "#gardening", type: "hashtag" },
  ];
  expect(
    filterTrendingForInterests(items, ["typescript"], []).map((item) =>
      item.type === "bluesky_topic" ? item.topic : ""
    )
  ).toEqual(["typescript"]);
  expect(filterTrendingForInterests(items, ["astronomy"], [])).toEqual([]);
  expect(filterTrendingForInterests(items, [], ["election"])).toHaveLength(2);
});

test("retains relevant topics beyond the global sidebar cutoff before interest filtering", () => {
  const globalTopics: TrendingItem[] = Array.from(
    { length: 9 },
    (_, index) => ({
      displayName: `Election headline ${index}`,
      source: "bluesky",
      topic: `election ${index}`,
      type: "bluesky_topic",
    })
  );
  const relevant: TrendingItem = {
    displayName: "Cyberpunk anime update",
    source: "bluesky",
    topic: "anime",
    type: "bluesky_topic",
  };
  const topics = [...globalTopics, relevant].filter(
    (item) => item.type === "bluesky_topic"
  );
  const candidates = weaveTrendingItems([], topics, 30);
  expect(
    filterTrendingForInterests(candidates, ["anime"], []).slice(0, 7)
  ).toEqual([relevant]);
  expect(filterTrendingForInterests(candidates, ["anime"], ["anime"])).toEqual(
    []
  );
});
