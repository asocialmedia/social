import { expect, test } from "bun:test";

import { filterTrendingForInterests } from "./trending-utils";
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
