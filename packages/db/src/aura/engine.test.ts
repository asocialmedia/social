import { describe, expect, test } from "bun:test";

import {
  CREDIBILITY_FLOOR,
  DAILY_INCOME_CAP,
  MOMENTUM_BUCKETS,
  PAIR_TAPER_MIN_FACTOR,
} from "./config";
import {
  computeCredibility,
  computeDailyCapFactor,
  computeEngagementWeight,
  computeMilestoneAura,
  computeMomentum,
  computePairTaperFactor,
  computeShareMilestoneAura,
  computeViewMilestoneAura,
  computeVisibilityWeight,
  computeWeightedAura,
  decomposeVoteTransition,
  getVoteComponentBaseAmount,
} from "./engine";
import type { MomentumEntry } from "./engine";

// Convenience builders so intent reads clearly in assertions below.
const veteran = { accountAgeDays: 90, lifetimeAura: 10_000 };
const establishedNoAura = { accountAgeDays: 90, lifetimeAura: 0 };
const brandNew = { accountAgeDays: 0, lifetimeAura: 0 };

describe("computeCredibility", () => {
  test("a day-zero account with no history sits at the floor", () => {
    expect(computeCredibility(brandNew)).toBe(CREDIBILITY_FLOOR);
  });

  test("a mature, high-aura account saturates at full credibility", () => {
    expect(computeCredibility(veteran)).toBeCloseTo(1, 6);
  });

  test("age alone cannot buy full credibility", () => {
    // Mature account with zero earned aura: halfway between floor and 1.
    expect(computeCredibility(establishedNoAura)).toBeCloseTo(0.625, 6);
  });

  test("aura alone cannot buy full credibility", () => {
    // Brand-new account with an implausibly huge balance stays low: the age
    // half of the score is what sockpuppets cannot forge.
    const bought = computeCredibility({
      accountAgeDays: 1,
      lifetimeAura: 10_000,
    });
    expect(bought).toBeLessThan(0.65);
    expect(bought).toBeGreaterThan(CREDIBILITY_FLOOR);
  });

  test("negative balances contribute zero, never subtract", () => {
    // Punishment lives in visibility, not credibility, so recovery earning
    // happens at normal rates.
    const inDebt = computeCredibility({
      accountAgeDays: 90,
      lifetimeAura: -5000,
    });
    expect(inDebt).toBeCloseTo(computeCredibility(establishedNoAura), 6);
  });

  test("account age saturates at the maturity horizon", () => {
    const oneYear = computeCredibility({
      accountAgeDays: 365,
      lifetimeAura: 0,
    });
    expect(oneYear).toBeCloseTo(
      computeCredibility({ accountAgeDays: 90, lifetimeAura: 0 }),
      6
    );
  });

  test("is monotonically non-decreasing in account age", () => {
    let previous = -Infinity;
    for (let days = 0; days <= 180; days += 15) {
      const value = computeCredibility({
        accountAgeDays: days,
        lifetimeAura: 5000,
      });
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  test("is monotonically non-decreasing in lifetime aura", () => {
    let previous = -Infinity;
    for (let aura = -1000; aura <= 20_000; aura += 1000) {
      const value = computeCredibility({
        accountAgeDays: 45,
        lifetimeAura: aura,
      });
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("computeEngagementWeight", () => {
  test("mirrors credibility today", () => {
    expect(computeEngagementWeight(0.42)).toBe(0.42);
  });

  test("clamps pathological inputs", () => {
    expect(computeEngagementWeight(1.5)).toBe(1);
    expect(computeEngagementWeight(-0.5)).toBe(0);
  });
});

describe("computePairTaperFactor", () => {
  test("first interaction is always full price", () => {
    expect(computePairTaperFactor(0)).toBe(1);
  });

  test("repeats decay as 1/(1+n/divisor)", () => {
    expect(computePairTaperFactor(1)).toBeCloseTo(0.75, 6);
    expect(computePairTaperFactor(2)).toBeCloseTo(0.6, 6);
    expect(computePairTaperFactor(3)).toBeCloseTo(0.5, 6);
    expect(computePairTaperFactor(9)).toBeCloseTo(0.25, 6);
  });

  test("never falls below the configured floor", () => {
    expect(computePairTaperFactor(12)).toBe(PAIR_TAPER_MIN_FACTOR);
    expect(computePairTaperFactor(10_000)).toBe(PAIR_TAPER_MIN_FACTOR);
  });
});

describe("computeDailyCapFactor", () => {
  test("income under the cap is untouched", () => {
    expect(computeDailyCapFactor(0)).toBe(1);
    expect(computeDailyCapFactor(DAILY_INCOME_CAP - 1)).toBe(1);
  });

  test("decays as cap/income once past the cap", () => {
    expect(computeDailyCapFactor(DAILY_INCOME_CAP)).toBe(1);
    expect(computeDailyCapFactor(DAILY_INCOME_CAP * 2)).toBeCloseTo(0.5, 6);
    expect(computeDailyCapFactor(DAILY_INCOME_CAP * 4)).toBeCloseTo(0.25, 6);
  });

  test("floors at the configured trickle rate", () => {
    expect(computeDailyCapFactor(DAILY_INCOME_CAP * 1000)).toBe(0.15);
  });
});

describe("computeWeightedAura", () => {
  test("veteran engagement moves the needle fully", () => {
    expect(
      computeWeightedAura(3, {
        actorAccountAgeDays: veteran.accountAgeDays,
        actorLifetimeAura: veteran.lifetimeAura,
      })
    ).toBe(3);
  });

  test("throwaway engagement rounds to nothing", () => {
    expect(
      computeWeightedAura(3, {
        actorAccountAgeDays: brandNew.accountAgeDays,
        actorLifetimeAura: brandNew.lifetimeAura,
      })
    ).toBe(0);
  });

  test("identical actions yield different, explainable results by credibility", () => {
    const base = 3;
    const byVeteran = computeWeightedAura(base, {
      actorAccountAgeDays: veteran.accountAgeDays,
      actorLifetimeAura: veteran.lifetimeAura,
    });
    const byEstablished = computeWeightedAura(base, {
      actorAccountAgeDays: establishedNoAura.accountAgeDays,
      actorLifetimeAura: establishedNoAura.lifetimeAura,
    });
    const byNewbie = computeWeightedAura(base, {
      actorAccountAgeDays: brandNew.accountAgeDays,
      actorLifetimeAura: brandNew.lifetimeAura,
    });
    expect(byVeteran).toBeGreaterThan(byEstablished);
    expect(byEstablished).toBeGreaterThan(byNewbie);
    // The difference decomposes exactly into the published formula.
    expect(byEstablished).toBe(Math.floor(base * 0.625));
  });

  test("losses round toward zero (under-penalize honest users)", () => {
    const loss = computeWeightedAura(-3, {
      actorAccountAgeDays: establishedNoAura.accountAgeDays,
      actorLifetimeAura: establishedNoAura.lifetimeAura,
    });
    expect(loss).toBe(-1); // ceil(-1.875)
  });

  test("taper compounds with weighting", () => {
    expect(
      computeWeightedAura(3, {
        actorAccountAgeDays: veteran.accountAgeDays,
        actorLifetimeAura: veteran.lifetimeAura,
        priorInteractions: 2,
      })
    ).toBe(1); // floor(3 * 0.6)
  });

  test("cap compounds with weighting", () => {
    expect(
      computeWeightedAura(3, {
        actorAccountAgeDays: veteran.accountAgeDays,
        actorLifetimeAura: veteran.lifetimeAura,
        recipientIncomeToday: DAILY_INCOME_CAP * 2,
      })
    ).toBe(1); // floor(3 * 0.5)
  });
});

describe("computeVisibilityWeight", () => {
  test("non-negative balances are fully visible", () => {
    expect(computeVisibilityWeight(0)).toBe(1);
    expect(computeVisibilityWeight(7500)).toBe(1);
  });

  test("negative balances slide down to the floor, never below", () => {
    expect(computeVisibilityWeight(-600)).toBeCloseTo(0.76, 6);
    // Raw weight hits zero at -DIVISOR, but the floor clamps from -1500 on.
    expect(computeVisibilityWeight(-1499)).toBeGreaterThan(0.4);
    expect(computeVisibilityWeight(-2500)).toBe(0.4);
    expect(computeVisibilityWeight(-100_000)).toBe(0.4);
  });
});

describe("computeMomentum", () => {
  const now = new Date("2026-08-24T12:00:00Z");
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 3_600_000);

  test("recent earnings weigh more than older ones", () => {
    const entries: MomentumEntry[] = [
      { amount: 10, createdAt: hoursAgo(1) },
      { amount: 10, createdAt: hoursAgo(72) },
      { amount: 10, createdAt: hoursAgo(200) },
    ];
    // 48h bucket x1, 7d bucket x0.5, 14d bucket x0.25.
    expect(computeMomentum(entries, now)).toBe(17.5);
  });

  test("entries older than the widest window contribute nothing", () => {
    const stale: MomentumEntry[] = [
      {
        amount: 1000,
        createdAt: hoursAgo(MOMENTUM_BUCKETS[2].maxAgeHours + 1),
      },
    ];
    expect(computeMomentum(stale, now)).toBe(0);
  });

  test("penalties drag recent momentum down", () => {
    const entries: MomentumEntry[] = [
      { amount: 40, createdAt: hoursAgo(2) },
      { amount: -100, createdAt: hoursAgo(3) },
    ];
    expect(computeMomentum(entries, now)).toBe(-60);
  });

  test("empty history is zero, not NaN", () => {
    expect(computeMomentum([], now)).toBe(0);
  });
});

describe("milestones", () => {
  test("views accrue +1 per 10 views with one-shot bonus tiers alongside", () => {
    expect(computeViewMilestoneAura(0, 9).aura).toBe(0);
    expect(computeViewMilestoneAura(0, 10).aura).toBe(1);
    // 13 full 10-view steps.
    expect(computeViewMilestoneAura(0, 130).aura).toBe(13);
    // 100 steps (100) + the 1K bonus (100).
    expect(computeViewMilestoneAura(0, 1000).aura).toBe(200);
    // 1000 steps (1000) + both bonuses (100 + 1000).
    expect(computeViewMilestoneAura(0, 10_000).aura).toBe(2100);
    // Steps already awarded at 120 do not re-award; 130..200 crossings pay.
    expect(computeViewMilestoneAura(120, 200)).toEqual({
      aura: 8,
      tiersCrossed: 8,
    });
  });

  test("multiple share tiers crossed at once are all awarded once", () => {
    const crossing = computeShareMilestoneAura(0, 260);
    expect(crossing.tiersCrossed).toBe(2);
    expect(crossing.aura).toBe(60);
  });

  test("share tiers cross superlinearly", () => {
    expect(computeShareMilestoneAura(24, 26).aura).toBe(10);
    expect(computeShareMilestoneAura(260, 261).aura).toBe(0);
  });

  test("shrinking counters never re-award", () => {
    expect(computeViewMilestoneAura(2000, 1500)).toEqual({
      aura: 0,
      tiersCrossed: 0,
    });
    expect(computeMilestoneAura([{ aura: 5, threshold: 10 }], 20, 5).aura).toBe(
      0
    );
  });

  test("exact boundary crossings count as reached", () => {
    expect(computeMilestoneAura([{ aura: 5, threshold: 10 }], 9, 10).aura).toBe(
      5
    );
  });
});

describe("decomposeVoteTransition", () => {
  test("simple applications", () => {
    expect(decomposeVoteTransition(0, 1)).toEqual([{ kind: "APPLY_AMPLIFY" }]);
    expect(decomposeVoteTransition(0, -1)).toEqual([{ kind: "APPLY_MUTE" }]);
  });

  test("simple removals", () => {
    expect(decomposeVoteTransition(1, 0)).toEqual([{ kind: "REMOVE_AMPLIFY" }]);
    expect(decomposeVoteTransition(-1, 0)).toEqual([{ kind: "REMOVE_MUTE" }]);
  });

  test("flips remove before they apply", () => {
    expect(decomposeVoteTransition(-1, 1)).toEqual([
      { kind: "REMOVE_MUTE" },
      { kind: "APPLY_AMPLIFY" },
    ]);
    expect(decomposeVoteTransition(1, -1)).toEqual([
      { kind: "REMOVE_AMPLIFY" },
      { kind: "APPLY_MUTE" },
    ]);
  });

  test("no-ops produce no events", () => {
    expect(decomposeVoteTransition(1, 1)).toEqual([]);
    expect(decomposeVoteTransition(0, 0)).toEqual([]);
    expect(decomposeVoteTransition(-1, -1)).toEqual([]);
  });

  test("amplify applies pay, mutes charge losses, removals reverse exactly", () => {
    expect(getVoteComponentBaseAmount({ kind: "APPLY_AMPLIFY" })).toBe(3);
    expect(getVoteComponentBaseAmount({ kind: "APPLY_MUTE" })).toBe(-3);
    // Removal amounts come from stored positions, never recomputation.
    expect(getVoteComponentBaseAmount({ kind: "REMOVE_AMPLIFY" })).toBe(0);
    expect(getVoteComponentBaseAmount({ kind: "REMOVE_MUTE" })).toBe(0);
  });
});
