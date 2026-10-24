import { describe, expect, test } from "bun:test";

import { networkTopicAffinity } from "./network-native-feed";

describe("networkTopicAffinity", () => {
  const profile = {
    activitySummary: {
      activeDays: 1,
      totalEngagements: 10,
    },
    authorWeights: {},
    communityWeights: {},
    expandedEntityWeights: {
      "machine-learning": 1.5,
    },
    negativeWeights: {},
    recentInteractions: [],
    sessionAuthorWeights: {},
    sessionCommunityWeights: {},
    sessionTagWeights: {
      rust: 2,
    },
    tagWeights: {
      typescript: 3,
    },
    topicAffinities: {},
    userId: "user-1",
  };

  test("calculates affinity from declared topics", () => {
    const affinity = networkTopicAffinity(
      "Check this out",
      ["typescript"],
      profile
    );
    expect(affinity).toBe(3);
  });

  test("matches whole word in text body case-insensitively and handles hyphenation", () => {
    const affinity = networkTopicAffinity(
      "I am studying machine learning today",
      [],
      profile
    );
    expect(affinity).toBe(1.5);
  });

  test("accumulates multiple matching tags and session weights", () => {
    const affinity = networkTopicAffinity(
      "Building a compiler in rust and typescript",
      ["rust", "typescript"],
      profile
    );
    expect(affinity).toBe(5);
  });

  test("avoids partial substring false positives", () => {
    // "rust" should not match "frustrated"
    const affinity = networkTopicAffinity(
      "I am so frustrated today",
      [],
      profile
    );
    expect(affinity).toBe(0);
  });

  test("returns 0 when there are no matches", () => {
    const affinity = networkTopicAffinity(
      "Unrelated cooking recipe",
      ["cooking"],
      profile
    );
    expect(affinity).toBe(0);
  });
});
