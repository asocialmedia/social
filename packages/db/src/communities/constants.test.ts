import { describe, expect, test } from "bun:test";

import {
  COMMUNITY_ACCENTS,
  COMMUNITY_CATEGORIES,
  COMMUNITY_LIMITS,
  COMMUNITY_TOPICS,
  DEFAULT_COMMUNITY_ACCENT,
  DEFAULT_COMMUNITY_CATEGORY,
  getCommunityAccent,
  getCommunityCategory,
  getCommunityTopic,
  isCommunityAccent,
  isCommunityCategory,
} from "./constants";

describe("community constants", () => {
  test("topic keys are unique and resolvable", () => {
    const keys = COMMUNITY_TOPICS.map((topic) => topic.key);
    expect(new Set(keys).size).toBe(keys.length);
    const [first] = COMMUNITY_TOPICS;
    if (!first) {
      throw new Error("expected at least one community topic");
    }
    expect(getCommunityTopic(first.key)).toEqual(first);
    expect(getCommunityTopic("nope")).toBeUndefined();
  });

  test("every topic carries an emoji and label", () => {
    for (const topic of COMMUNITY_TOPICS) {
      expect(topic.emoji.length).toBeGreaterThan(0);
      expect(topic.label.length).toBeGreaterThan(0);
    }
  });

  test("accent keys are unique and resolve to tonal pairs", () => {
    const keys = COMMUNITY_ACCENTS.map((accent) => accent.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const accent of COMMUNITY_ACCENTS) {
      // Both values must be real colors so the rail clears its surface in
      // either theme.
      expect(accent.light).toMatch(/^#[\da-f]{6}$/i);
      expect(accent.dark).toMatch(/^#[\da-f]{6}$/i);
    }
  });

  test("unknown accents fall back to the default", () => {
    expect(isCommunityAccent("slate")).toBe(true);
    expect(isCommunityAccent("nope")).toBe(false);
    expect(getCommunityAccent("nope").key).toBe(DEFAULT_COMMUNITY_ACCENT);
  });

  test("limits are internally consistent", () => {
    expect(COMMUNITY_LIMITS.nameMin).toBeLessThan(COMMUNITY_LIMITS.nameMax);
    expect(COMMUNITY_LIMITS.slugMin).toBeLessThan(COMMUNITY_LIMITS.slugMax);
    expect(COMMUNITY_LIMITS.topicMax).toBeGreaterThan(0);
    expect(COMMUNITY_LIMITS.descriptionMax).toBeGreaterThan(0);
  });

  test("default category is All and resolvable", () => {
    expect(DEFAULT_COMMUNITY_CATEGORY).toBe("all");
    expect(isCommunityCategory("all")).toBe(true);
    expect(isCommunityCategory("gaming")).toBe(true);
    expect(isCommunityCategory("nope")).toBe(false);
    expect(getCommunityCategory("all")?.topics).toHaveLength(0);
  });

  test("every topic belongs to exactly one non-All category", () => {
    const seen = new Map<string, string>();
    for (const category of COMMUNITY_CATEGORIES) {
      if (category.key === "all") {
        continue;
      }
      for (const topic of category.topics) {
        // No topic may be filed under two categories, or a community would be
        // double-counted in the discovery filter row.
        expect(seen.has(topic)).toBe(false);
        seen.set(topic, category.key);
      }
    }
    for (const topic of COMMUNITY_TOPICS) {
      expect(seen.has(topic.key)).toBe(true);
    }
    // ...and no category references a topic key that does not exist.
    for (const topic of seen.keys()) {
      expect(getCommunityTopic(topic)).toBeDefined();
    }
  });

  test("category keys are unique and every one resolves", () => {
    const keys = COMMUNITY_CATEGORIES.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(getCommunityCategory(key)?.key).toBe(key);
    }
  });
});
