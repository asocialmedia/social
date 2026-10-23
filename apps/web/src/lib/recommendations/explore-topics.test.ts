import { expect, test } from "bun:test";

import { exploreTopics } from "./explore-topics";

test("Explore tries observed neighbors and taxonomy siblings without repeating primary interests or exclusions", () => {
  const topics = exploreTopics(
    {
      authorWeights: {},
      expandedEntityWeights: {
        hardware: 0.7,
        networking: 0.4,
        politics: 0.2,
        "web development": 1,
      },
      tagWeights: { "web development": 1 },
    },
    ["web development"],
    ["politics"],
    {
      avoided: {},
      interests: {},
      related: { "web development": ["hardware", "embedded systems"] },
      version: "test",
    }
  );
  expect(topics).toEqual(["hardware", "embedded systems", "networking"]);
});

test("Explore does not invent a relationship when no public topic evidence exists", () => {
  expect(
    exploreTopics(
      { authorWeights: {}, tagWeights: { "web development": 1 } },
      ["web development"],
      []
    )
  ).toEqual([]);
});

test("Explore excludes taxonomy partitions before limiting useful related queries", () => {
  const administrative = Array.from(
    { length: 20 },
    (_, index) => `anime by studio ${index}`
  );
  expect(
    exploreTopics({ authorWeights: {}, tagWeights: {} }, ["anime"], [], {
      avoided: {},
      interests: {},
      related: {
        anime: [
          ...administrative,
          "anime and manga redirects",
          "anime series",
          "tv anime",
        ],
      },
      version: "taxonomy-regression",
    })
  ).toEqual(["anime series", "tv anime"]);
});
