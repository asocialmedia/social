import { describe, expect, it } from "bun:test";

import { HN_RAIL_COLOR, getPostRailColor } from "./feed-rail";

describe("getPostRailColor", () => {
  it("resolves community accent color for a community post", () => {
    const post = {
      community: { accentColor: "stone" },
    };
    expect(getPostRailColor(post, true)).toBe("#a8a29e");
    expect(getPostRailColor(post, false)).toBe("#57534e");
  });

  it("resolves community accent color from communityShare when community is missing", () => {
    const post = {
      communityShare: {
        community: { accentColor: "pine" },
      },
    };
    expect(getPostRailColor(post, true)).toBe("#34d399");
    expect(getPostRailColor(post, false)).toBe("#047857");
  });

  it("resolves signature orange rail for an HN embedded post", () => {
    const post = {
      hnStoryShare: {
        by: "test",
        descendants: 5,
        score: 10,
        storyId: 1234,
        time: 1000,
        title: "Test HN story",
      },
    };
    expect(getPostRailColor(post, true)).toBe(HN_RAIL_COLOR);
    expect(getPostRailColor(post, false)).toBe(HN_RAIL_COLOR);
  });

  it("prefers community rail over HN rail if a post somehow has both", () => {
    const post = {
      community: { accentColor: "ember" },
      hnStoryShare: { storyId: 1 },
    };
    expect(getPostRailColor(post, true)).toBe("#fb923c");
  });

  it("returns null for a regular post without community or HN embed", () => {
    const post = {};
    expect(getPostRailColor(post, true)).toBeNull();
    expect(getPostRailColor(post, false)).toBeNull();
  });
});
