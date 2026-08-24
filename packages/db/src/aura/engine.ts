import {
  AGE_FACTOR_SHARE,
  AMPLIFY_RECEIVE_AURA,
  CREDIBILITY_FLOOR,
  DAILY_CAP_FLOOR_RATIO,
  DAILY_INCOME_CAP,
  MUTE_RECEIVE_AURA,
  MOMENTUM_BUCKETS,
  NEW_ACCOUNT_MATURITY_DAYS,
  PAIR_TAPER_DIVISOR,
  PAIR_TAPER_MIN_FACTOR,
  SHARE_MILESTONE_TIERS,
  VETERAN_AURA,
  VIEW_MILESTONE_KILO_BONUS_AURA,
  VIEW_MILESTONE_KILO_BONUS_VIEWS,
  VIEW_MILESTONE_STEP_AURA,
  VIEW_MILESTONE_STEP_VIEWS,
  VISIBILITY_NEGATIVE_DIVISOR,
  VISIBILITY_WEIGHT_FLOOR,
} from "./config";

// ---------------------------------------------------------------------------
// Pure aura math. No database, no clock reads without an explicit `now` -
// every function here is deterministic given its inputs so the whole economy
// can be unit-tested without mocking Prisma or Redis.
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000;

export interface CredibilityInput {
  accountAgeDays: number;
  lifetimeAura: number;
}

// Credibility in [CREDIBILITY_FLOOR, 1]: how much influence this account's
// engagement carries. Half comes from account age (saturating linearly over
// NEW_ACCOUNT_MATURITY_DAYS), half from lifetime aura (log-scaled to
// VETERAN_AURA). Negative balances contribute zero to the aura half but do
// not subtract - punishment lives in visibilityWeight, not credibility, so a
// recovering user can still earn their way back at normal rates.
export function computeCredibility(input: CredibilityInput): number {
  const ageFactor = clamp01(input.accountAgeDays / NEW_ACCOUNT_MATURITY_DAYS);
  const positiveAura = Math.max(0, input.lifetimeAura);
  const auraFactor = clamp01(
    Math.log10(1 + positiveAura) / Math.log10(1 + VETERAN_AURA)
  );
  const raw =
    AGE_FACTOR_SHARE * ageFactor + (1 - AGE_FACTOR_SHARE) * auraFactor;
  return CREDIBILITY_FLOOR + (1 - CREDIBILITY_FLOOR) * raw;
}

// Engagement from an actor with `credibility` is worth this fraction of a
// base award. Currently identity with credibility, kept as a named concept
// so tuning can decouple them later without touching call sites.
export function computeEngagementWeight(credibility: number): number {
  return clamp01(credibility);
}

// Pairwise taper for the n-th repeat interaction of one class between the
// same two accounts inside the taper window. `priorInteractions` counts
// events BEFORE this one, so 0 returns 1 (first interaction is full price).
export function computePairTaperFactor(priorInteractions: number): number {
  if (priorInteractions <= 0) {
    return 1;
  }
  const factor = 1 / (1 + priorInteractions / PAIR_TAPER_DIVISOR);
  return Math.max(PAIR_TAPER_MIN_FACTOR, factor);
}

// Soft daily income cap. `incomeSoFar` is positive engagement/creation income
// already earned today (before this award). Past the cap the rate decays as
// CAP/income, floored so extreme volume still trickles through.
export function computeDailyCapFactor(incomeSoFar: number): number {
  if (incomeSoFar < DAILY_INCOME_CAP) {
    return 1;
  }
  return Math.max(DAILY_CAP_FLOOR_RATIO, DAILY_INCOME_CAP / incomeSoFar);
}

export interface AwardContext {
  actorAccountAgeDays: number;
  actorLifetimeAura: number;
  // Prior same-class interactions actor -> recipient inside the taper window.
  priorInteractions?: number;
  // Positive income recipient has already earned today (cap accounting).
  recipientIncomeToday?: number;
}

// Full pipeline for a weighted award: credibility weight x pair taper x daily
// cap, rounded conservatively (gains floor, losses ceil - toward zero both
// ways, so tuning mistakes under-deliver rather than over-punish).
export function computeWeightedAura(
  baseAmount: number,
  context: AwardContext
): number {
  const weight = computeEngagementWeight(
    computeCredibility({
      accountAgeDays: context.actorAccountAgeDays,
      lifetimeAura: context.actorLifetimeAura,
    })
  );
  const taper = computePairTaperFactor(context.priorInteractions ?? 0);
  const cap = computeDailyCapFactor(context.recipientIncomeToday ?? 0);
  const scaled = baseAmount * weight * taper * cap;
  return scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled);
}

// Visibility multiplier for negative balances; positive balances are always
// exactly 1. Soft consequence only - nothing anywhere blocks on aura sign.
export function computeVisibilityWeight(lifetimeAura: number): number {
  if (lifetimeAura >= 0) {
    return 1;
  }
  return Math.max(
    VISIBILITY_WEIGHT_FLOOR,
    1 + lifetimeAura / VISIBILITY_NEGATIVE_DIVISOR
  );
}

// Momentum: recency-weighted ledger earnings. Entries older than the largest
// bucket window contribute nothing. Negative entries drag momentum down, so
// penalty-heavy recent history reads as "cooling off".
export interface MomentumEntry {
  amount: number;
  createdAt: Date;
}

export function computeMomentum(entries: MomentumEntry[], now: Date): number {
  let momentum = 0;
  for (const entry of entries) {
    const ageHours = (now.getTime() - entry.createdAt.getTime()) / MS_PER_HOUR;
    for (const bucket of MOMENTUM_BUCKETS) {
      if (ageHours <= bucket.maxAgeHours) {
        momentum += entry.amount * bucket.weight;
        break;
      }
    }
  }
  // Signals are advisory inputs to ranking; keep them on integer-ish rails
  // so cached values are stable across serializations.
  return Math.round(momentum * 100) / 100;
}

// Attention milestones (views, shares): award once per tier boundary crossed
// between the previously awarded count and the new total. Generic over tier
// tables so new tiers are a config edit, not a code change.
export interface MilestoneAward {
  aura: number;
  tiersCrossed: number;
}

export function computeMilestoneAura(
  tiers: readonly { aura: number; threshold: number }[],
  lastAwardedCount: number,
  newTotal: number
): MilestoneAward {
  let aura = 0;
  let tiersCrossed = 0;
  for (const tier of tiers) {
    if (lastAwardedCount < tier.threshold && newTotal >= tier.threshold) {
      aura += tier.aura;
      tiersCrossed += 1;
    }
  }
  return { aura, tiersCrossed };
}

export function computeViewMilestoneAura(
  lastAwardedViewCount: number,
  newTotalViews: number
): MilestoneAward {
  // The shipped curve is periodic rather than one-shot thresholds: every
  // full 50 views pays STEP_AURA, and every full 1000 views pays an extra
  // KILO bonus on top.
  const prevSteps = Math.max(
    0,
    Math.floor(lastAwardedViewCount / VIEW_MILESTONE_STEP_VIEWS)
  );
  const newSteps = Math.floor(newTotalViews / VIEW_MILESTONE_STEP_VIEWS);
  const prevKilos = Math.max(
    0,
    Math.floor(lastAwardedViewCount / VIEW_MILESTONE_KILO_BONUS_VIEWS)
  );
  const newKilos = Math.floor(newTotalViews / VIEW_MILESTONE_KILO_BONUS_VIEWS);

  const stepsCrossed = Math.max(0, newSteps - prevSteps);
  const kilosCrossed = Math.max(0, newKilos - prevKilos);

  return {
    aura:
      stepsCrossed * VIEW_MILESTONE_STEP_AURA +
      kilosCrossed * VIEW_MILESTONE_KILO_BONUS_AURA,
    tiersCrossed: stepsCrossed + kilosCrossed,
  };
}

export function computeShareMilestoneAura(
  lastAwardedShareCount: number,
  newTotalShares: number
): MilestoneAward {
  return computeMilestoneAura(
    SHARE_MILESTONE_TIERS,
    lastAwardedShareCount,
    newTotalShares
  );
}

// Vote transitions decompose into independent economy events so each can be
// weighted, tapered, and reversed on its own ledger rows. E.g. switching a
// mute to an amplify yields [remove mute, apply amplify].
export type VoteComponent =
  | { kind: "APPLY_AMPLIFY" }
  | { kind: "APPLY_MUTE" }
  | { kind: "REMOVE_AMPLIFY" }
  | { kind: "REMOVE_MUTE" };

export function decomposeVoteTransition(
  oldValue: number,
  newValue: number
): VoteComponent[] {
  const components: VoteComponent[] = [];
  if (oldValue === 1 && newValue !== 1) {
    components.push({ kind: "REMOVE_AMPLIFY" });
  }
  if (oldValue === -1 && newValue !== -1) {
    components.push({ kind: "REMOVE_MUTE" });
  }
  if (newValue === 1 && oldValue !== 1) {
    components.push({ kind: "APPLY_AMPLIFY" });
  }
  if (newValue === -1 && oldValue !== -1) {
    components.push({ kind: "APPLY_MUTE" });
  }
  return components;
}

// Author-side base amount for a vote component. Amplify gains and mute
// losses use their configured magnitudes; removals are handled by exact
// ledger reversal, not by recomputation (see reverseAward in ledger.ts).
export function getVoteComponentBaseAmount(component: VoteComponent): number {
  switch (component.kind) {
    case "APPLY_AMPLIFY": {
      return AMPLIFY_RECEIVE_AURA;
    }
    case "APPLY_MUTE": {
      return -MUTE_RECEIVE_AURA;
    }
    case "REMOVE_AMPLIFY":
    case "REMOVE_MUTE": {
      // Removals reverse stored positions exactly; they never recompute.
      return 0;
    }
    default: {
      return 0;
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
