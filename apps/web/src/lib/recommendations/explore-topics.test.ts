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
