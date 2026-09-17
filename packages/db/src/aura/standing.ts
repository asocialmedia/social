// Community standing: the credential community founding is gated on.
//
// Aura is the reward currency and is uncapped for viral reach on purpose - a
// breakout post should pay off fully. Standing is a SEPARATE, derived number so
// that same virality cannot buy a permanent credential outright. It is:
//
//   standing = (earned aura excluding attention milestones and founding
//               bonuses)
//            + min(attention-milestone aura, COMMUNITY_REACH_ALLOWANCE)
//
// Reach counts, but saturates. See COMMUNITY_REACH_ALLOWANCE in ./config for
// the full rationale.
//
// Derived on read from aura_logs (never stored as a balance), so it cannot
// drift from the ledger. Both aggregates ride the existing
// @@index([userId, createdAt]).

import prisma from "../prisma";
import {
  ATTENTION_MILESTONE_TYPES,
  COMMUNITY_REACH_ALLOWANCE,
  STANDING_EXCLUDED_TYPES,
} from "./config";

export interface CommunityStanding {
  // Earned aura that counts toward the credential (milestones capped).
  standing: number;
  // The account's raw aura balance, for display alongside standing.
  aura: number;
  // How much attention-milestone aura the account has earned in total.
  reachAura: number;
  // The portion of reachAura actually counted (<= the allowance).
  reachCounted: number;
}

const MILESTONE_TYPES = [...ATTENTION_MILESTONE_TYPES];
const EXCLUDED_TYPES = [...STANDING_EXCLUDED_TYPES];

// The subset of the Prisma client standing reads. Structural so the global
// client and a transaction client both satisfy it without casts.
// oxlint-disable typescript/method-signature-style -- method syntax keeps bivariant assignment from the generated Prisma client's overloaded methods
export interface StandingClient {
  auraLog: {
    aggregate(args: {
      _sum: { amount: true };
      where: Record<string, unknown>;
    }): Promise<{ _sum: { amount: number | null } }>;
  };
  user: {
    findUnique(args: {
      select: { aura: true };
      where: { id: string };
    }): Promise<{ aura: number } | null>;
  };
}
// oxlint-enable typescript/method-signature-style

// Pure standing math, split out so it is unit-testable without a database.
export function computeStanding(input: {
  aura: number;
  milestoneAura: number;
  nonMilestoneAura: number;
}): CommunityStanding {
  const reachAura = Math.max(0, input.milestoneAura);
  const reachCounted = Math.min(reachAura, COMMUNITY_REACH_ALLOWANCE);
  return {
    aura: input.aura,
    reachAura,
    reachCounted,
    standing: input.nonMilestoneAura + reachCounted,
  };
}

// Reads the ledger aggregates and folds them into standing. `aura` comes from
// the user row rather than the ledger sum so it matches the number every other
// surface displays (legacy rows predate some ledger types).
export async function computeStandingForUser(
  client: StandingClient,
  userId: string
): Promise<CommunityStanding> {
  if (!userId) {
    return computeStanding({ aura: 0, milestoneAura: 0, nonMilestoneAura: 0 });
  }

  const [user, milestoneAgg, creditableAgg] = await Promise.all([
    client.user.findUnique({ select: { aura: true }, where: { id: userId } }),
    client.auraLog.aggregate({
      _sum: { amount: true },
      where: {
        amount: { gt: 0 },
        type: { in: MILESTONE_TYPES },
        userId,
      },
    }),
    client.auraLog.aggregate({
      _sum: { amount: true },
      where: {
        amount: { gt: 0 },
        type: { notIn: EXCLUDED_TYPES },
        userId,
      },
    }),
  ]);

  return computeStanding({
    aura: user?.aura ?? 0,
    milestoneAura: milestoneAgg._sum.amount ?? 0,
    nonMilestoneAura: creditableAgg._sum.amount ?? 0,
  });
}

export function getCommunityStanding(
  userId: string
): Promise<CommunityStanding> {
  return computeStandingForUser(prisma, userId);
}

// Batched variant for callers that need many accounts at once (a leaderboard,
// a moderation queue). One grouped query per aggregate instead of two per user.
export async function getCommunityStandingForUsers(
  userIds: string[]
): Promise<Record<string, CommunityStanding>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) {
    return {};
  }

  const [users, milestoneRows, creditableRows] = await Promise.all([
    prisma.user.findMany({
      select: { aura: true, id: true },
      where: { id: { in: ids } },
    }),
    prisma.auraLog.groupBy({
      _sum: { amount: true },
      by: ["userId"],
      where: {
        amount: { gt: 0 },
        type: { in: MILESTONE_TYPES },
        userId: { in: ids },
      },
    }),
    prisma.auraLog.groupBy({
      _sum: { amount: true },
      by: ["userId"],
      where: {
        amount: { gt: 0 },
        type: { notIn: EXCLUDED_TYPES },
        userId: { in: ids },
      },
    }),
  ]);

  const auraById = new Map(users.map((user) => [user.id, user.aura]));
  const milestoneById = new Map(
    milestoneRows.map((row) => [row.userId, row._sum.amount ?? 0])
  );
  const creditableById = new Map(
    creditableRows.map((row) => [row.userId, row._sum.amount ?? 0])
  );

  const result: Record<string, CommunityStanding> = {};
  for (const id of ids) {
    result[id] = computeStanding({
      aura: auraById.get(id) ?? 0,
      milestoneAura: milestoneById.get(id) ?? 0,
      nonMilestoneAura: creditableById.get(id) ?? 0,
    });
  }
  return result;
}
