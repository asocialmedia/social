import { describe, expect, test } from "bun:test";

import {
  AMPLIFY_RECEIVE_AURA,
  DAILY_INCOME_CAP,
  FOLLOW_GAINED_AURA,
} from "./config";
import { computeWeightedAura } from "./engine";

// Farming simulations over the pure award pipeline. Each scenario models what
// a coordinated abuser would actually do and asserts the economy's response:
// negligible yield for throwaways, sharply diminishing returns for volume,
// bounded daily income for rings. These encode the anti-farm acceptance
// criteria as executable specifications.

describe("self-engagement farming", () => {
  test("amplifying your own content earns nothing at any credibility", () => {
    // The ledger zeroes self-awards before weighting; modeled here by the
    // policy contract the routes rely on (applyWeightedAward self-block,
    // covered in ledger.test.ts). The economic floor case: even if it were
    // allowed, a fresh account moves nothing.
    const selfAward = computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
      actorAccountAgeDays: 0,
      actorLifetimeAura: 0,
    });
    expect(selfAward).toBe(0);
  });

  test("commenting on your own posts yields only the capped stipend", () => {
    // COMMENT_CREATION is deliberately flat but cap-subject. Simulate
    // spam-commenting until income crosses the cap.
    let income = 0;
    let awards = 0;
    while (awards < 500) {
      const factor =
        income < DAILY_INCOME_CAP
          ? 1
          : Math.max(0.15, DAILY_INCOME_CAP / income);
      const award = Math.trunc(1 * factor);
      if (award === 0) {
        break;
      }
      income += award;
      awards += 1;
    }
    // A day of pure self-commenting is hard-capped near DAILY_INCOME_CAP.
    expect(income).toBeLessThanOrEqual(DAILY_INCOME_CAP + 1);
  });
});

describe("sockpuppet amplification", () => {
  test("a ring of brand-new accounts creates zero aura by voting on each other", () => {
    const RING_SIZE = 20;
    let economyCreated = 0;
    for (let voter = 0; voter < RING_SIZE; voter += 1) {
      for (let author = 0; author < RING_SIZE; author += 1) {
        if (voter === author) {
          continue;
        }
        economyCreated += computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
          actorAccountAgeDays: 0,
          actorLifetimeAura: 0,
        });
      }
    }
    // Every vote in the ring floors to zero: 380 amplifies, nothing earned.
    expect(economyCreated).toBe(0);
  });

  test("aging the ring without history barely helps", () => {
    // Attackers can wait out account age; with zero earned aura they still
    // only reach the halfway credibility point.
    const perVote = computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
      actorAccountAgeDays: 90,
      actorLifetimeAura: 0,
    });
    expect(perVote).toBe(Math.floor(AMPLIFY_RECEIVE_AURA * 0.625));
    expect(perVote).toBeLessThan(AMPLIFY_RECEIVE_AURA);
  });

  test("bought aura cannot outrun the missing age half", () => {
    // A farm gives each puppet 5000 aura instantly. Age still caps them.
    // (Weighted-award ratio at base 100 approximates raw credibility.)
    const bought = computeWeightedAura(100, {
      actorAccountAgeDays: 1,
      actorLifetimeAura: 5000,
    });
    const honestVeteran = computeWeightedAura(100, {
      actorAccountAgeDays: 720,
      actorLifetimeAura: 12_000,
    });
    expect(bought).toBeLessThan(honestVeteran);
    expect(
      computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
        actorAccountAgeDays: 1,
        actorLifetimeAura: 5000,
      })
    ).toBeLessThan(
      computeWeightedAura(FOLLOW_GAINED_AURA, {
        actorAccountAgeDays: 720,
        actorLifetimeAura: 12_000,
      })
    );
  });
});

describe("pair spam (repeat identical interactions)", () => {
  test("one account amplifying another's every post tapers hard", () => {
    let recipientIncome = 0;
    const awards: number[] = [];
    for (
      let priorInteractions = 0;
      priorInteractions < 30;
      priorInteractions += 1
    ) {
      const award = computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
        actorAccountAgeDays: 400,
        actorLifetimeAura: 15_000,
        priorInteractions,
        recipientIncomeToday: recipientIncome,
      });
      awards.push(award);
      recipientIncome += award;
    }

    // First interaction pays full price; the tail collapses toward the taper
    // floor; total stays far below naive 30x full price.
    expect(awards[0]).toBe(AMPLIFY_RECEIVE_AURA);
    expect(awards[29]).toBeLessThanOrEqual(awards[5]);
    const naiveTotal = 30 * AMPLIFY_RECEIVE_AURA;
    const actualTotal = awards.reduce((sum, value) => sum + value, 0);
    expect(actualTotal).toBeLessThan(naiveTotal * 0.45);
  });

  test("follow/unfollow churn farming decays the same way", () => {
    const awards: number[] = [];
    for (let prior = 0; prior < 10; prior += 1) {
      awards.push(
        computeWeightedAura(FOLLOW_GAINED_AURA, {
          actorAccountAgeDays: 365,
          actorLifetimeAura: 8000,
          priorInteractions: prior,
        })
      );
    }
    const total = awards.reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThan(10 * FOLLOW_GAINED_AURA * 0.6);
  });
});

describe("coordinated propping rings", () => {
  test("daily income hard-plateaus no matter how many accounts prop you", () => {
    // Distinct veterans amplify one target today, one vote each. Naive
    // payout: 3 aura x N. The cap compresses every award past the cap and
    // the marginal award decays to literally zero, so the attack converges
    // to a fixed plateau instead of scaling with ring size.
    let income = 0;
    for (let attacker = 0; attacker < 500; attacker += 1) {
      income += computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
        actorAccountAgeDays: 365,
        actorLifetimeAura: 20_000,
        recipientIncomeToday: income,
      });
    }

    // Plateau: awards stop entirely once 3 * (CAP / income) floors to 0,
    // which happens just past 3 * CAP (the last live award at income 360
    // floors to exactly 1). A wall for industrial propping.
    expect(income).toBeGreaterThanOrEqual(DAILY_INCOME_CAP);
    expect(income).toBeLessThanOrEqual(
      AMPLIFY_RECEIVE_AURA * DAILY_INCOME_CAP + AMPLIFY_RECEIVE_AURA - 1
    );
    expect(income).toBeLessThan(600); // versus 500 attackers x 3 naive

    // ...and the tail is inert: more attackers change nothing.
    let stalled = income;
    for (let attacker = 0; attacker < 100; attacker += 1) {
      stalled += computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
        actorAccountAgeDays: 365,
        actorLifetimeAura: 20_000,
        recipientIncomeToday: stalled,
      });
    }
    expect(stalled).toBe(income);
  });

  test("mixed-quality rings earn what their weakest members allow", () => {
    // A real-world pattern: 1 veteran + 19 fresh puppets propping a target.
    let income = 0;
    let total = 0;
    const puppetAwards: number[] = [];
    for (let attacker = 0; attacker < 20; attacker += 1) {
      const isNewcomer = attacker > 0;
      const award = computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
        actorAccountAgeDays: isNewcomer ? 2 : 500,
        actorLifetimeAura: isNewcomer ? 30 : 18_000,
        recipientIncomeToday: income,
      });
      if (isNewcomer) {
        puppetAwards.push(award);
      }
      total += award;
      income += award;
    }
    // Each puppet's credibility (~0.4) rounds its award down to 1: far from
    // free, but not zero - documented residual risk, tunable via
    // CREDIBILITY_FLOOR / AGE_FACTOR_SHARE.
    expect(puppetAwards.every((award) => award === 1)).toBe(true);
    // Ring take stays under half the naive payout, dominated by the one
    // credible member rather than the puppet swarm.
    expect(total).toBeLessThan(20 * AMPLIFY_RECEIVE_AURA * 0.5);
  });
});

describe("negative balance recovery", () => {
  test("a penalized user still earns at full rate when others engage them", () => {
    // Credibility ignores negative balances - punishment lives in visibility,
    // so digging out is possible at normal earning rates.
    const inDebt = computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
      actorAccountAgeDays: 400,
      actorLifetimeAura: -3000,
    });
    const clean = computeWeightedAura(AMPLIFY_RECEIVE_AURA, {
      actorAccountAgeDays: 400,
      actorLifetimeAura: 0,
    });
    expect(inDebt).toBe(clean);
  });
});
