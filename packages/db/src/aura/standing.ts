import { and } from "@prisma/orm-postgres/orm-client";

import prisma from "../prisma";
import type { PrismaOrm } from "../prisma";
import {
  ATTENTION_MILESTONE_TYPES,
  COMMUNITY_REACH_ALLOWANCE,
  STANDING_EXCLUDED_TYPES,
} from "./config";

export interface CommunityStanding {
  standing: number;
  aura: number;
  reachAura: number;
  reachCounted: number;
}

const MILESTONE_TYPES = [...ATTENTION_MILESTONE_TYPES];
const EXCLUDED_TYPES = [...STANDING_EXCLUDED_TYPES];

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

export async function computeStandingForUser(
  orm: PrismaOrm,
  userId: string
): Promise<CommunityStanding> {
  if (!userId) {
    return computeStanding({ aura: 0, milestoneAura: 0, nonMilestoneAura: 0 });
  }

  const [user, milestoneAgg, creditableAgg] = await Promise.all([
    orm.public.Users.select("aura").where({ id: userId }).first(),
    orm.public.AuraLogs.where((log) =>
      and(
        log.amount.gt(0),
        log._type.in(MILESTONE_TYPES),
        log.userId.eq(userId)
      )
    ).aggregate((aggregate) => ({ total: aggregate.sum("amount") })),
    orm.public.AuraLogs.where((log) =>
      and(log.amount.gt(0), log._type.in(EXCLUDED_TYPES), log.userId.eq(userId))
    ).aggregate((aggregate) => ({ total: aggregate.sum("amount") })),
  ]);

  return computeStanding({
    aura: user?.aura ?? 0,
    milestoneAura: milestoneAgg.total ?? 0,
    nonMilestoneAura: creditableAgg.total ?? 0,
  });
}

export function getCommunityStanding(
  userId: string
): Promise<CommunityStanding> {
  return computeStandingForUser(prisma.orm, userId);
}

export async function getCommunityStandingForUsers(
  userIds: string[]
): Promise<Record<string, CommunityStanding>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) {
    return {};
  }

  const [users, milestoneRows, creditableRows] = await Promise.all([
    prisma.orm.public.Users.select("aura", "id")
      .where((user) => user.id.in(ids))
      .all(),
    prisma.orm.public.AuraLogs.where((log) =>
      and(log.amount.gt(0), log._type.in(MILESTONE_TYPES), log.userId.in(ids))
    )
      .groupBy("userId")
      .aggregate((aggregate) => ({ total: aggregate.sum("amount") })),
    prisma.orm.public.AuraLogs.where((log) =>
      and(log.amount.gt(0), log._type.in(EXCLUDED_TYPES), log.userId.in(ids))
    )
      .groupBy("userId")
      .aggregate((aggregate) => ({ total: aggregate.sum("amount") })),
  ]);

  const auraById = new Map(users.map((user) => [user.id, user.aura]));
  const milestoneById = new Map(
    milestoneRows.map((row) => [row.userId, row.total ?? 0])
  );
  const creditableById = new Map(
    creditableRows.map((row) => [row.userId, row.total ?? 0])
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
