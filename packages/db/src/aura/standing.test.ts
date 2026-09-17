import { describe, expect, test } from "bun:test";

import { COMMUNITY_REACH_ALLOWANCE } from "./config";
import { computeStanding } from "./standing";

// Pure standing math. The whole point of the split is that attention
// milestones (views, shares) count toward founding only up to an allowance,
// while every other earned award counts in full. These tests pin that
// boundary, since a regression here silently re-opens the "one viral post
// buys a permanent credential" hole.
describe("computeStanding", () => {
  test("counts non-milestone income in full", () => {
    const result = computeStanding({
      aura: 4000,
      milestoneAura: 0,
      nonMilestoneAura: 4000,
    });
    expect(result.standing).toBe(4000);
    expect(result.reachCounted).toBe(0);
  });

  test("caps reach at the allowance", () => {
    const result = computeStanding({
      aura: 50_000,
      milestoneAura: 50_000,
      nonMilestoneAura: 0,
    });
    expect(result.reachAura).toBe(50_000);
    expect(result.reachCounted).toBe(COMMUNITY_REACH_ALLOWANCE);
    expect(result.standing).toBe(COMMUNITY_REACH_ALLOWANCE);
  });

  test("reach below the allowance passes through untouched", () => {
    const result = computeStanding({
      aura: 600,
      milestoneAura: 600,
      nonMilestoneAura: 0,
    });
    expect(result.reachCounted).toBe(600);
    expect(result.standing).toBe(600);
  });

  test("a viral post alone cannot clear the second tier", () => {
    // The original hole: 100k views paid 11,100 aura and unlocked three
    // communities. Under standing it clears only the first bar.
    const standing = computeStanding({
      aura: 11_100,
      milestoneAura: 11_100,
      nonMilestoneAura: 0,
    });
    expect(standing.standing).toBe(COMMUNITY_REACH_ALLOWANCE);
    expect(standing.standing).toBeLessThan(5000);
  });

  test("reach plus sustained income stacks, reach capped", () => {
    const result = computeStanding({
      aura: 20_000,
      milestoneAura: 8000,
      nonMilestoneAura: 12_000,
    });
    expect(result.standing).toBe(12_000 + COMMUNITY_REACH_ALLOWANCE);
  });

  test("negative or missing aggregates cannot reduce standing", () => {
    const result = computeStanding({
      aura: 500,
      milestoneAura: -200,
      nonMilestoneAura: 500,
    });
    expect(result.reachAura).toBe(0);
    expect(result.reachCounted).toBe(0);
    expect(result.standing).toBe(500);
  });

  test("aura is reported separately from standing", () => {
    const result = computeStanding({
      aura: 30_000,
      milestoneAura: 25_000,
      nonMilestoneAura: 5000,
    });
    // Aura stays the full reward score; standing is the clipped credential.
    expect(result.aura).toBe(30_000);
    expect(result.standing).toBe(5000 + COMMUNITY_REACH_ALLOWANCE);
  });
});
