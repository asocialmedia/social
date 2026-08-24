import {
  AMPLIFY_RECEIVE_AURA,
  applyWeightedAward,
  chargeMutingCost,
  decomposeVoteTransition,
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  invalidateAuraSignals,
  MUTE_RECEIVE_AURA,
  prisma,
  reverseExactAura,
} from "@asm/db";
import type { CommentVoteInfo, Prisma } from "@asm/db";

import { runSerializableTransaction } from "@/lib/db-transactions";
import { getSessionFromApi } from "@/lib/session";

const VALID_VOTE_VALUES = new Set([-1, 0, 1]);

// Open economy positions carried by a comment-vote row: signed net author-side
// amount (+amplify gain / -mute loss) and the muter honesty cost charged.
interface OpenPositions {
  awardedAura: number;
  mutingCostAura: number;
}

// Settles one vote transition against the open positions stored on the vote
// row, returning the new totals to persist. Removals reverse EXACTLY what is
// standing; applications go through the weighted/tapered/capped pipeline.
// Self-engagement is zeroed in the engine; self-mutes still pay the cost.
// oxlint-disable no-await-in-loop -- transition components share running totals and must settle strictly in order
async function settleCommentVoteEconomy(
  tx: Prisma.TransactionClient,
  input: {
    actor: { aura: number; createdAt: Date };
    actorId: string;
    commentId: string;
    newValue: number;
    oldValue: number;
    postId: string;
    recipientId: string;
    positions: OpenPositions;
  }
): Promise<OpenPositions> {
  let totalAwarded = input.positions.awardedAura;
  let totalCost = input.positions.mutingCostAura;
  const now = new Date();

  for (const component of decomposeVoteTransition(
    input.oldValue,
    input.newValue
  )) {
    switch (component.kind) {
      case "REMOVE_AMPLIFY": {
        const standingAmplify = Math.max(0, totalAwarded);
        if (standingAmplify !== 0) {
          await reverseExactAura(tx, {
            commentId: input.commentId,
            issuerId: input.actorId,
            openAmount: standingAmplify,
            postId: input.postId,
            recipientId: input.recipientId,
            type: "COMMENT_VOTE_REMOVED",
          });
          totalAwarded -= standingAmplify;
        }
        break;
      }
      case "APPLY_AMPLIFY": {
        const { amount } = await applyWeightedAward(tx, {
          actor: input.actor,
          actorId: input.actorId,
          baseAmount: AMPLIFY_RECEIVE_AURA,
          commentId: input.commentId,
          now,
          postId: input.postId,
          recipientId: input.recipientId,
          subjectToDailyCap: true,
          taperClass: "amplify",
          type: "COMMENT_VOTE",
        });
        totalAwarded += amount;
        break;
      }
      case "APPLY_MUTE": {
        const { amount } = await applyWeightedAward(tx, {
          actor: input.actor,
          actorId: input.actorId,
          baseAmount: -MUTE_RECEIVE_AURA,
          commentId: input.commentId,
          now,
          postId: input.postId,
          recipientId: input.recipientId,
          subjectToDailyCap: false,
          type: "COMMENT_VOTE_REMOVED",
        });
        totalAwarded += amount;

        // Every mute costs its issuer, even on their own content.
        const { amount: costAmount } = await chargeMutingCost(tx, {
          commentId: input.commentId,
          muterId: input.actorId,
          postId: input.postId,
        });
        totalCost += costAmount;
        break;
      }
      case "REMOVE_MUTE": {
        const standingMute = Math.min(0, totalAwarded);
        if (standingMute !== 0) {
          await reverseExactAura(tx, {
            commentId: input.commentId,
            issuerId: input.actorId,
            openAmount: standingMute,
            postId: input.postId,
            recipientId: input.recipientId,
            type: "COMMENT_VOTE",
          });
        }
        totalAwarded = Math.max(0, totalAwarded);

        if (totalCost !== 0) {
          await reverseExactAura(tx, {
            commentId: input.commentId,
            issuerId: input.actorId,
            openAmount: totalCost,
            postId: input.postId,
            recipientId: input.actorId,
            type: "MUTING_COST",
          });
          totalCost = 0;
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  return { awardedAura: totalAwarded, mutingCostAura: totalCost };
}
// oxlint-enable no-await-in-loop

export async function GET(
  _req: Request,
  props: { params: Promise<{ commentId: string }> }
) {
  const { commentId } = await props.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const comment = await prisma.comment.findUnique({
    select: { aura: true },
    where: { id: commentId },
  });

  if (!comment) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  const vote = await prisma.commentVote.findUnique({
    where: { userId_commentId: { commentId, userId: user.id } },
  });

  const voteInfo: CommentVoteInfo = {
    aura: comment.aura,
    userVote: vote?.value || 0,
  };

  return Response.json(voteInfo);
}

export async function POST(
  request: Request,
  props: { params: Promise<{ commentId: string }> }
) {
  const { commentId } = await props.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { value } = (await request.json()) as { value?: number };
  if (typeof value !== "number" || !VALID_VOTE_VALUES.has(value)) {
    return Response.json({ error: "Invalid vote value" }, { status: 400 });
  }

  let affectedAuthorId: string | null = null;
  try {
    // Serializable + retry so a concurrent vote re-reads committed state
    // instead of double-applying an aura delta.
    const result = await runSerializableTransaction(async (tx) => {
      const comment = await tx.comment.findUnique({
        select: { aura: true, id: true, postId: true, userId: true },
        where: { id: commentId },
      });
      if (!comment) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.commentVote.findUnique({
          where: { userId_commentId: { commentId, userId: user.id } },
        }),
        tx.user.findUnique({
          select: { aura: true, createdAt: true },
          where: { id: user.id },
        }),
      ]);
      if (!actor) {
        return null;
      }

      const oldValue = existingVote?.value ?? 0;
      affectedAuthorId = comment.userId;

      const positions = await settleCommentVoteEconomy(tx, {
        actor: { aura: actor.aura, createdAt: actor.createdAt },
        actorId: user.id,
        commentId,
        newValue: value,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId: comment.postId,
        recipientId: comment.userId,
      });

      if (value === 0) {
        if (existingVote) {
          await tx.commentVote.delete({
            where: { userId_commentId: { commentId, userId: user.id } },
          });
        }
      } else {
        await tx.commentVote.upsert({
          create: {
            awardedAura: positions.awardedAura,
            commentId,
            mutingCostAura: positions.mutingCostAura,
            userId: user.id,
            value,
          },
          update: {
            awardedAura: positions.awardedAura,
            mutingCostAura: positions.mutingCostAura,
            value,
          },
          where: { userId_commentId: { commentId, userId: user.id } },
        });
      }

      // Raw score keeps +-1-per-vote semantics; only User.aura is weighted.
      const auraDelta = value - oldValue;
      if (auraDelta !== 0) {
        await tx.comment.update({
          data: { aura: { increment: auraDelta } },
          where: { id: commentId },
        });
      }

      // Only notify others, never yourself.
      const isSelfVote = comment.userId === user.id;
      let wasAmplified = false;
      let wasAmplifyRemoved = false;
      if (!isSelfVote) {
        if (value === 1 && oldValue !== 1) {
          wasAmplified = true;
          await tx.notification.create({
            data: {
              commentId,
              issuerId: user.id,
              postId: comment.postId,
              recipientId: comment.userId,
              type: "AMPLIFY",
            },
          });
          enqueueNotificationCreated(comment.userId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue eddie amplify notification event:",
              error
            );
          });
        } else if (value !== 1 && oldValue === 1) {
          wasAmplifyRemoved = true;
          await tx.notification.deleteMany({
            where: {
              commentId,
              issuerId: user.id,
              postId: comment.postId,
              recipientId: comment.userId,
              type: "AMPLIFY",
            },
          });
          enqueueNotificationDeleted(comment.userId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue eddie amplify removal notification event:",
              error
            );
          });
        }
      }

      const updated = await tx.comment.findUnique({
        select: { aura: true },
        where: { id: commentId },
      });

      return {
        aura: updated?.aura ?? comment.aura,
        postId: comment.postId,
        userVote: value === 0 ? 0 : value,
        wasAmplified,
        wasAmplifyRemoved,
      };
    });

    if (!result) {
      return Response.json({ error: "Comment not found" }, { status: 404 });
    }

    if (affectedAuthorId) {
      // Fire-and-forget: signals serve ranking heuristics and fall back to a
      // TTL refresh, so a failed invalidation only costs freshness.
      try {
        await invalidateAuraSignals([affectedAuthorId, user.id]);
      } catch (error) {
        console.error("Failed to invalidate aura signals:", error);
      }
    }

    const voteInfo: CommentVoteInfo = {
      aura: result.aura,
      userVote: result.userVote,
    };

    return Response.json(voteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ commentId: string }> }
) {
  const { commentId } = await props.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSerializableTransaction(async (tx) => {
      const comment = await tx.comment.findUnique({
        select: { aura: true, postId: true, userId: true },
        where: { id: commentId },
      });
      if (!comment) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.commentVote.findUnique({
          where: { userId_commentId: { commentId, userId: user.id } },
        }),
        tx.user.findUnique({
          select: { aura: true, createdAt: true },
          where: { id: user.id },
        }),
      ]);
      if (!actor) {
        return null;
      }

      const oldValue = existingVote?.value ?? 0;

      await settleCommentVoteEconomy(tx, {
        actor: { aura: actor.aura, createdAt: actor.createdAt },
        actorId: user.id,
        commentId,
        newValue: 0,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId: comment.postId,
        recipientId: comment.userId,
      });

      if (existingVote) {
        await tx.commentVote.delete({
          where: { userId_commentId: { commentId, userId: user.id } },
        });
      }

      const auraDelta = 0 - oldValue;
      if (auraDelta !== 0) {
        await tx.comment.update({
          data: { aura: { decrement: oldValue } },
          where: { id: commentId },
        });
      }

      // Only notify others, never yourself.
      const isSelfVote = comment.userId === user.id;
      if (oldValue === 1 && !isSelfVote) {
        await tx.notification.deleteMany({
          where: {
            commentId,
            issuerId: user.id,
            postId: comment.postId,
            recipientId: comment.userId,
            type: "AMPLIFY",
          },
        });
        enqueueNotificationDeleted(comment.userId).catch((error: unknown) => {
          console.error(
            "Failed to enqueue eddie amplify removal notification event:",
            error
          );
        });
      }

      const updated = await tx.comment.findUnique({
        select: { aura: true },
        where: { id: commentId },
      });

      return { aura: updated?.aura ?? comment.aura, userVote: 0 };
    });

    if (!result) {
      return Response.json({ error: "Comment not found" }, { status: 404 });
    }

    return Response.json(result satisfies CommentVoteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
