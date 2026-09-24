import { randomUUID } from "node:crypto";

import { and } from "@prisma/orm-postgres/orm-client";

import { toPrismaDateTime } from "../prisma";
import type { PrismaTransaction } from "../prisma";
import {
  MODERATION_PENALTY_AURA,
  MUTING_COST_AURA,
  PAIR_TAPER_WINDOW_DAYS,
  TAPER_CLASSES,
} from "./config";
import { computeDailyCapFactor, computeWeightedAura } from "./engine";

export type AuraEventType =
  | "COMMENT_CREATION"
  | "COMMENT_RECEIVED"
  | "COMMUNITY_CREATED"
  | "COMMUNITY_JOIN"
  | "COMMUNITY_JOIN_OWNER"
  | "COMMENT_VOTE"
  | "COMMENT_VOTE_REMOVED"
  | "FOLLOW_GAINED"
  | "FOLLOW_GIVEN"
  | "HN_SHARE_BONUS"
  | "MENTION_RECEIVED"
  | "MODERATION_PENALTY"
  | "MUTING_COST"
  | "POST_ATTACHMENT_BONUS"
  | "POST_BOOKMARKED"
  | "POST_BOOKMARK_RECEIVED"
  | "POST_CREATION"
  | "POST_VIEWS_MILESTONE"
  | "POST_VOTE"
  | "POST_VOTE_REMOVED"
  | "SHARE_MILESTONE"
  | "TRENDING_APPEARANCE";

export type TaperClass = keyof typeof TAPER_CLASSES;

export interface AuraLedgerEntry {
  amount: number;
  commentId?: string | null;
  issuerId: string;
  postId?: string | null;
  targetUserId: string;
  type: AuraEventType;
  userId: string;
}

export interface AuraLedgerOperations {
  countAuraLogs: (input: {
    actorId: string;
    classTypes: readonly AuraEventType[];
    since: Date;
    recipientId: string;
  }) => Promise<number>;
  createAuraLog: (input: AuraLedgerEntry) => Promise<void>;
  incrementUserAura: (userId: string, amount: number) => Promise<void>;
  sumEngagementIncome: (input: {
    since: Date;
    recipientId: string;
  }) => Promise<number>;
}

export type AuraLedgerContext = PrismaTransaction | AuraLedgerOperations;

function isAuraLedgerOperations(
  context: AuraLedgerContext
): context is AuraLedgerOperations {
  return "incrementUserAura" in context;
}

async function incrementUserAuraWithCas(
  transaction: PrismaTransaction,
  userId: string,
  amount: number
): Promise<void> {
  const user = await transaction.orm.public.Users.select("aura")
    .where({ id: userId })
    .first();
  if (!user) {
    throw new Error(`Cannot update aura for missing user ${userId}`);
  }
  const nextAura = user.aura + amount;
  const updated = await transaction.orm.public.Users.where((candidate) =>
    and(candidate.id.eq(userId), candidate.aura.eq(user.aura))
  ).updateAndCount({ aura: nextAura });
  return updated === 1
    ? undefined
    : incrementUserAuraWithCas(transaction, userId, amount);
}

function createAuraLedgerOperations(
  transaction: PrismaTransaction
): AuraLedgerOperations {
  return {
    async countAuraLogs(input) {
      const result = await transaction.orm.public.AuraLogs.where((log) =>
        and(
          log.amount.gt(0),
          log.createdAt.gte(toPrismaDateTime(input.since)),
          log.issuerId.eq(input.actorId),
          log.targetUserId.eq(input.recipientId),
          log._type.in([...input.classTypes])
        )
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      return result.count;
    },
    async createAuraLog(input) {
      await transaction.orm.public.AuraLogs.create({
        _type: input.type,
        amount: input.amount,
        commentId: input.commentId ?? null,
        id: randomUUID(),
        issuerId: input.issuerId,
        postId: input.postId ?? null,
        targetUserId: input.targetUserId,
        userId: input.userId,
      });
    },
    async incrementUserAura(userId, amount) {
      await incrementUserAuraWithCas(transaction, userId, amount);
    },
    async sumEngagementIncome(input) {
      const result = await transaction.orm.public.AuraLogs.where((log) =>
        and(
          log.amount.gt(0),
          log.createdAt.gte(toPrismaDateTime(input.since)),
          log._type.notIn([
            "POST_VIEWS_MILESTONE",
            "SHARE_MILESTONE",
            "TRENDING_APPEARANCE",
          ]),
          log.userId.eq(input.recipientId)
        )
      ).aggregate((aggregate) => ({ total: aggregate.sum("amount") }));
      return result.total ?? 0;
    },
  };
}

function operationsFor(context: AuraLedgerContext): AuraLedgerOperations {
  return isAuraLedgerOperations(context)
    ? context
    : createAuraLedgerOperations(context);
}

const MS_PER_DAY = 86_400_000;

export interface AwardInput {
  type: AuraEventType;
  actorId: string;
  recipientId: string;
  baseAmount: number;
  actor: { aura: number; createdAt: Date };
  now: Date;
  postId?: string | null;
  commentId?: string | null;
  taperClass?: TaperClass | null;
  subjectToDailyCap?: boolean;
  allowSelfAward?: boolean;
}

interface AppliedAward {
  amount: number;
}

export async function applyWeightedAward(
  context: AuraLedgerContext,
  input: AwardInput
): Promise<AppliedAward> {
  const operations = operationsFor(context);
  if (!input.allowSelfAward && input.actorId === input.recipientId) {
    return { amount: 0 };
  }

  const priorInteractions = input.taperClass
    ? await operations.countAuraLogs({
        actorId: input.actorId,
        classTypes: TAPER_CLASSES[input.taperClass],
        recipientId: input.recipientId,
        since: new Date(
          input.now.getTime() - PAIR_TAPER_WINDOW_DAYS * MS_PER_DAY
        ),
      })
    : 0;

  const recipientIncomeToday = input.subjectToDailyCap
    ? await operations.sumEngagementIncome({
        recipientId: input.recipientId,
        since: startOfUtcDay(input.now),
      })
    : 0;

  const amount = computeWeightedAura(input.baseAmount, {
    actorAccountAgeDays:
      (input.now.getTime() - input.actor.createdAt.getTime()) / MS_PER_DAY,
    actorLifetimeAura: input.actor.aura,
    priorInteractions,
    recipientIncomeToday,
  });

  if (amount === 0) {
    return { amount: 0 };
  }

  await operations.incrementUserAura(input.recipientId, amount);
  await operations.createAuraLog({
    amount,
    commentId: input.commentId ?? null,
    issuerId: input.actorId,
    postId: input.postId ?? null,
    targetUserId: input.recipientId,
    type: input.type,
    userId: input.recipientId,
  });

  return { amount };
}

export async function applyFlatAward(
  context: AuraLedgerContext,
  input: {
    type: AuraEventType;
    actorId: string;
    recipientId: string;
    baseAmount: number;
    now: Date;
    postId?: string | null;
    commentId?: string | null;
    subjectToDailyCap?: boolean;
  }
): Promise<AppliedAward> {
  const operations = operationsFor(context);
  const recipientIncomeToday = input.subjectToDailyCap
    ? await operations.sumEngagementIncome({
        recipientId: input.recipientId,
        since: startOfUtcDay(input.now),
      })
    : 0;

  const amount = input.subjectToDailyCap
    ? Math.trunc(input.baseAmount * computeDailyCapFactor(recipientIncomeToday))
    : Math.trunc(input.baseAmount);

  if (amount === 0) {
    return { amount: 0 };
  }

  await operations.incrementUserAura(input.recipientId, amount);
  await operations.createAuraLog({
    amount,
    commentId: input.commentId ?? null,
    issuerId: input.actorId,
    postId: input.postId ?? null,
    targetUserId: input.recipientId,
    type: input.type,
    userId: input.recipientId,
  });

  return { amount };
}

export async function chargeMutingCost(
  context: AuraLedgerContext,
  input: { muterId: string; postId?: string | null; commentId?: string | null }
): Promise<AppliedAward> {
  const operations = operationsFor(context);
  await operations.incrementUserAura(input.muterId, -MUTING_COST_AURA);
  await operations.createAuraLog({
    amount: -MUTING_COST_AURA,
    commentId: input.commentId ?? null,
    issuerId: input.muterId,
    postId: input.postId ?? null,
    targetUserId: input.muterId,
    type: "MUTING_COST",
    userId: input.muterId,
  });
  return { amount: -MUTING_COST_AURA };
}

export interface ReversalResult {
  amount: number;
}

export async function reverseExactAura(
  context: AuraLedgerContext,
  input: {
    recipientId: string;
    openAmount: number;
    issuerId: string;
    type: AuraEventType;
    postId?: string | null;
    commentId?: string | null;
    targetUserId?: string | null;
  }
): Promise<ReversalResult> {
  if (input.openAmount === 0) {
    return { amount: 0 };
  }

  const operations = operationsFor(context);
  const reversed = -input.openAmount;
  await operations.incrementUserAura(input.recipientId, reversed);
  await operations.createAuraLog({
    amount: reversed,
    commentId: input.commentId ?? null,
    issuerId: input.issuerId,
    postId: input.postId ?? null,
    targetUserId: input.targetUserId ?? input.recipientId,
    type: input.type,
    userId: input.recipientId,
  });
  return { amount: reversed };
}

export async function applyModerationPenalty(
  context: AuraLedgerContext,
  input: { actorId: string; recipientId: string; postId?: string | null }
): Promise<AppliedAward> {
  const operations = operationsFor(context);
  await operations.incrementUserAura(
    input.recipientId,
    -MODERATION_PENALTY_AURA
  );
  await operations.createAuraLog({
    amount: -MODERATION_PENALTY_AURA,
    issuerId: input.actorId,
    postId: input.postId ?? null,
    targetUserId: input.recipientId,
    type: "MODERATION_PENALTY",
    userId: input.recipientId,
  });
  return { amount: -MODERATION_PENALTY_AURA };
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
}
