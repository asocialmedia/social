import {
  MODERATION_PENALTY_AURA,
  MUTING_COST_AURA,
  PAIR_TAPER_WINDOW_DAYS,
  TAPER_CLASSES,
} from "./config";
import { computeDailyCapFactor, computeWeightedAura } from "./engine";

// The ONLY code paths allowed to mutate User.aura or write AuraLog rows live
// in this file (plus the view-flush worker's batched raw-SQL path, which
// imports its milestone curve from ./config). Every point earned or lost is
// traceable: an AuraLog row is written for every non-zero mutation, carrying
// who caused it (issuerId), whose balance moved (userId), who the underlying
// action targeted (targetUserId), what happened (type), where it happened
// (postId/commentId), and how much moved (amount).

// Structural transaction surface: just what the ledger needs. The generated
// Prisma.TransactionClient satisfies this shape directly, and unit tests can
// pass plain fakes without casts.
// oxlint-disable typescript/method-signature-style -- method syntax keeps bivariant assignment from the generated Prisma client's overloaded methods
export interface AuraLedgerTx {
  auraLog: {
    aggregate(args: {
      _sum: { amount: true };
      where: Record<string, unknown>;
    }): Promise<{ _sum: { amount: number | null } }>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    update(args: {
      data: { aura: { increment: number } };
      where: { id: string };
    }): Promise<unknown>;
  };
}
// oxlint-enable typescript/method-signature-style

type Tx = AuraLedgerTx;

// Union of AuraType values the engine writes. Kept as a string union rather
// than importing the generated enum so unit tests can fake ledger rows with
// plain objects.
export type AuraEventType =
  | "COMMENT_CREATION"
  | "COMMENT_RECEIVED"
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

// Interaction classes sharing a pairwise taper counter. The tables live in
// config.TAPER_CLASSES; counted over positive award rows so reversals never
// inflate or reduce someone's taper position.
export type TaperClass = keyof typeof TAPER_CLASSES;

const MS_PER_DAY = 86_400_000;

export interface AwardInput {
  // Ledger type describing the surface action.
  type: AuraEventType;
  // Account whose action caused the award (the voter, commenter, follower...).
  actorId: string;
  // Account whose balance changes.
  recipientId: string;
  baseAmount: number;
  // Actor snapshot read inside the caller's transaction.
  actor: { aura: number; createdAt: Date };
  // Explicit clock: keeps the whole pipeline deterministic in tests.
  now: Date;
  postId?: string | null;
  commentId?: string | null;
  // Apply the pairwise taper for this interaction class.
  taperClass?: TaperClass | null;
  // Subject the award to the receiver's daily income cap.
  subjectToDailyCap?: boolean;
  // Interpersonal awards are zeroed when the actor engages their own content
  // (self-farming is not income). Awards that are naturally self-issued -
  // bookmark-received on own content is blocked at the route, but any future
  // self-directed weighted award must opt out here explicitly. Default false.
  allowSelfAward?: boolean;
}

interface AppliedAward {
  amount: number;
}

// Applies one weighted, anti-farmed award and ledgers it. Returns the signed
// integer actually applied (0 when policy zeroes the award or rounding floors
// it away - no ledger row is written for zero deltas, there is no point to
// trace). Must run inside the caller's serializable transaction.
export async function applyWeightedAward(
  tx: Tx,
  input: AwardInput
): Promise<AppliedAward> {
  if (!input.allowSelfAward && input.actorId === input.recipientId) {
    return { amount: 0 };
  }

  const priorInteractions = input.taperClass
    ? await countPriorInteractions(tx, {
        actorId: input.actorId,
        classTypes: TAPER_CLASSES[input.taperClass],
        now: input.now,
        recipientId: input.recipientId,
      })
    : 0;

  const recipientIncomeToday = input.subjectToDailyCap
    ? await getEngagementIncomeToday(tx, {
        now: input.now,
        recipientId: input.recipientId,
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

  await tx.user.update({
    data: { aura: { increment: amount } },
    where: { id: input.recipientId },
  });

  await tx.auraLog.create({
    data: {
      amount,
      commentId: input.commentId ?? null,
      issuerId: input.actorId,
      postId: input.postId ?? null,
      targetUserId: input.recipientId,
      type: input.type,
      userId: input.recipientId,
    },
  });

  return { amount };
}

// Flat (unweighted, untapered) award for participation income such as post /
// comment / bookmark-given credits. Still subject to the daily cap when
// requested, still fully ledgered. Returns the applied amount.
export async function applyFlatAward(
  tx: Tx,
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
  const recipientIncomeToday = input.subjectToDailyCap
    ? await getEngagementIncomeToday(tx, {
        now: input.now,
        recipientId: input.recipientId,
      })
    : 0;

  // Same soft-cap curve as weighted awards: untouched under the cap,
  // decaying as CAP/income past it, floored at the trickle rate.
  const amount = input.subjectToDailyCap
    ? Math.trunc(input.baseAmount * computeDailyCapFactor(recipientIncomeToday))
    : Math.trunc(input.baseAmount);

  if (amount === 0) {
    return { amount: 0 };
  }

  await tx.user.update({
    data: { aura: { increment: amount } },
    where: { id: input.recipientId },
  });

  await tx.auraLog.create({
    data: {
      amount,
      commentId: input.commentId ?? null,
      issuerId: input.actorId,
      postId: input.postId ?? null,
      targetUserId: input.recipientId,
      type: input.type,
      userId: input.recipientId,
    },
  });

  return { amount };
}

// Charges the muter's honesty cost. Flat, never tapered or capped: every
// mute costs, which is the point.
export async function chargeMutingCost(
  tx: Tx,
  input: {
    muterId: string;
    postId?: string | null;
    commentId?: string | null;
  }
): Promise<AppliedAward> {
  await tx.user.update({
    data: { aura: { increment: -MUTING_COST_AURA } },
    where: { id: input.muterId },
  });

  await tx.auraLog.create({
    data: {
      amount: -MUTING_COST_AURA,
      commentId: input.commentId ?? null,
      issuerId: input.muterId,
      postId: input.postId ?? null,
      targetUserId: input.muterId,
      type: "MUTING_COST",
      userId: input.muterId,
    },
  });

  return { amount: -MUTING_COST_AURA };
}

export interface ReversalResult {
  // Signed amount applied (= negation of the open position); 0 when nothing
  // was open.
  amount: number;
}

// Reverses an EXACT previously-awarded amount. Callers read the open
// position from the owning relation row (Vote.awardedAura, Bookmark.authorAura,
// Comment.receivedAura, ...) so removal always unwinds precisely what was
// awarded, even though weighting/tapering/capping made amounts vary over
// time. Zero open positions (legacy rows created before the economy shipped)
// reverse nothing: under-refunding an old action is conservative, silently
// re-charging someone is not.
export async function reverseExactAura(
  tx: Tx,
  input: {
    recipientId: string;
    // Signed open position currently applied (+gain, -loss).
    openAmount: number;
    issuerId: string;
    // Ledger type recorded on the reversal row itself.
    type: AuraEventType;
    postId?: string | null;
    commentId?: string | null;
    targetUserId?: string | null;
  }
): Promise<ReversalResult> {
  if (input.openAmount === 0) {
    return { amount: 0 };
  }

  const reversed = -input.openAmount;

  await tx.user.update({
    data: { aura: { increment: reversed } },
    where: { id: input.recipientId },
  });

  await tx.auraLog.create({
    data: {
      amount: reversed,
      commentId: input.commentId ?? null,
      issuerId: input.issuerId,
      postId: input.postId ?? null,
      targetUserId: input.targetUserId ?? input.recipientId,
      type: input.type,
      userId: input.recipientId,
    },
  });

  return { amount: reversed };
}

// One-way moderation penalty. Never refunded anywhere by design; exposed here
// so the moderation route and this file stay the only balance writers.
export async function applyModerationPenalty(
  tx: Tx,
  input: { actorId: string; recipientId: string; postId?: string | null }
): Promise<AppliedAward> {
  await tx.user.update({
    data: { aura: { increment: -MODERATION_PENALTY_AURA } },
    where: { id: input.recipientId },
  });

  await tx.auraLog.create({
    data: {
      amount: -MODERATION_PENALTY_AURA,
      issuerId: input.actorId,
      postId: input.postId ?? null,
      targetUserId: input.recipientId,
      type: "MODERATION_PENALTY",
      userId: input.recipientId,
    },
  });

  return { amount: -MODERATION_PENALTY_AURA };
}

async function countPriorInteractions(
  tx: Tx,
  input: {
    actorId: string;
    classTypes: readonly AuraEventType[];
    now: Date;
    recipientId: string;
  }
): Promise<number> {
  const windowStart = new Date(
    input.now.getTime() - PAIR_TAPER_WINDOW_DAYS * MS_PER_DAY
  );

  const counted = await tx.auraLog.count({
    where: {
      amount: { gt: 0 },
      createdAt: { gte: windowStart },
      issuerId: input.actorId,
      targetUserId: input.recipientId,
      type: { in: [...input.classTypes] },
    },
  });

  return counted;
}

// Positive interpersonal + creation income received today (UTC), excluding
// attention milestones AND platform recognition awards (trending card):
// like milestones these bypass the daily cap entirely, so they must not
// consume any of its budget either. Drives the soft daily cap.
async function getEngagementIncomeToday(
  tx: Tx,
  input: { now: Date; recipientId: string }
): Promise<number> {
  const dayStart = startOfUtcDay(input.now);

  const summed = await tx.auraLog.aggregate({
    _sum: { amount: true },
    where: {
      amount: { gt: 0 },
      createdAt: { gte: dayStart },
      type: {
        notIn: [
          "POST_VIEWS_MILESTONE",
          "SHARE_MILESTONE",
          "TRENDING_APPEARANCE",
        ],
      },
      userId: input.recipientId,
    },
  });

  return summed._sum.amount ?? 0;
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
