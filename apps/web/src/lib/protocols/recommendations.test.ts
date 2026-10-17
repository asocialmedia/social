import { expect, test } from "bun:test";

import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";

import { discoveryTopics, rankExternalForViewer } from "./recommendations";

const profile: UserProfile = {
  authorWeights: {},
  negativeTagWeights: { politics: 5 },
  tagWeights: { astronomy: 8, gardening: 2, politics: 1 },
};
const post = (id: string, text: string) =>
  ({ author: { description: "" }, id, text }) as ExternalPost;

test("discovery terms come from weighted persona signals without negative topics or query operators", () => {
  expect(discoveryTopics(profile)).toEqual(["astronomy", "gardening"]);
  expect(
    discoveryTopics({
      authorWeights: {},
      tagWeights: { "from:someone OR *": 2 },
    })
  ).toEqual(["from someone OR"]);
});

test("different personas rank the same live candidates differently and penalize negative interests", () => {
  const posts = [
    post("politics", "politics"),
    post("garden", "gardening"),
    post("space", "astronomy"),
  ];
  expect(rankExternalForViewer(posts, profile).map((item) => item.id)).toEqual([
    "space",
    "garden",
    "politics",
  ]);
  expect(
    rankExternalForViewer(posts, {
      authorWeights: {},
      tagWeights: { gardening: 10 },
    })[0]?.id
  ).toBe("garden");
  expect(posts[0]?.id).toBe("politics");
});
