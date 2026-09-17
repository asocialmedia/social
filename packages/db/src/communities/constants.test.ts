import { describe, expect, test } from "bun:test";

import {
  COMMUNITY_ACCENTS,
  COMMUNITY_CATEGORIES,
  COMMUNITY_CREATION_AURA_TIERS,
  COMMUNITY_FOUNDING_BONUSES,
  COMMUNITY_LIMITS,
  COMMUNITY_MAX_OWNED,
  COMMUNITY_TOPICS,
  communityCreationAuraRequirement,
  communityFoundingBonus,
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

  test("every topic carries a label", () => {
    for (const topic of COMMUNITY_TOPICS) {
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

  test("creation aura tiers ascend and cap at the owned-community limit", () => {
    // The array length IS the cap, so the two can never disagree.
    expect(COMMUNITY_MAX_OWNED).toBe(COMMUNITY_CREATION_AURA_TIERS.length);
    expect(COMMUNITY_MAX_OWNED).toBe(10);

    const tiers = [...COMMUNITY_CREATION_AURA_TIERS];
    for (let index = 1; index < tiers.length; index += 1) {
      const previous = tiers[index - 1];
      const current = tiers[index];
      if (previous === undefined || current === undefined) {
        throw new Error("unexpected gap in creation tiers");
      }
      expect(current).toBeGreaterThan(previous);
    }

    // The two committed milestones: 6 communities at 25k, 10 (the cap) at 50k.
    expect(COMMUNITY_CREATION_AURA_TIERS[5]).toBe(25_000);
    expect(COMMUNITY_CREATION_AURA_TIERS[9]).toBe(50_000);

    expect(communityCreationAuraRequirement(0)).toBe(1000);
    expect(communityCreationAuraRequirement(1)).toBe(5000);
    expect(communityCreationAuraRequirement(2)).toBe(10_000);
    expect(communityCreationAuraRequirement(3)).toBe(15_000);
    // At and past the cap there is no next community to unlock.
    expect(communityCreationAuraRequirement(COMMUNITY_MAX_OWNED)).toBeNull();
    expect(
      communityCreationAuraRequirement(COMMUNITY_MAX_OWNED + 5)
    ).toBeNull();
  });

  test("founding bonuses escalate then flatten, one per tier", () => {
    // Parallel to the tiers: the reward for founding the Nth community.
    expect(COMMUNITY_FOUNDING_BONUSES).toHaveLength(COMMUNITY_MAX_OWNED);

    expect(communityFoundingBonus(0)).toBe(500);
    expect(communityFoundingBonus(1)).toBe(1000);
    expect(communityFoundingBonus(2)).toBe(2000);
    expect(communityFoundingBonus(3)).toBe(5000);
    expect(communityFoundingBonus(4)).toBe(10_000);
    // Flat tail: never larger than the fifth, so it cannot explode.
    for (let index = 4; index < COMMUNITY_MAX_OWNED; index += 1) {
      expect(communityFoundingBonus(index)).toBe(10_000);
    }
    // Past the cap there is nothing to pay.
    expect(communityFoundingBonus(COMMUNITY_MAX_OWNED)).toBe(0);
    expect(communityFoundingBonus(99)).toBe(0);
  });
});
