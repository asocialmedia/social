import { AMPLIFY_RECEIVE_AURA, MUTE_RECEIVE_AURA } from "./config";
import { decomposeVoteTransition } from "./engine";
import type { AuraEventType } from "./ledger";
import {
  applyWeightedAward,
  chargeMutingCost,
  reverseExactAura,
} from "./ledger";

// Shared vote-economy settlement used by both the post-vote and comment-vote
// routes. Transitions decompose into independent economy events (see
// decomposeVoteTransition); removals reverse EXACTLY what is standing via
// stored open positions, applications go through the weighted/tapered/capped
// pipeline. Self-engagement is zeroed inside the engine; self-mutes still pay
// the muting cost.
//
// oxlint-disable no-await-in-loop -- transition components share running totals and must settle strictly in order
export interface VoteOpenPositions {
  awardedAura: number;
  mutingCostAura: number;
}

export interface SettleVoteTransitionInput {
  actor: { aura: number; createdAt: Date };
  actorId: string;
  // Set for comment votes so every ledger row points at both surfaces.
  commentId?: string;
  newValue: number;
  oldValue: number;
  postId: string;
  recipientId: string;
  positions: VoteOpenPositions;
  // Surface-specific ledger types: posts use POST_VOTE/POST_VOTE_REMOVED,
  // comments use COMMENT_VOTE/COMMENT_VOTE_REMOVED.
  types: {
    amplifyApplied: AuraEventType;
    amplifyRemoved: AuraEventType;
    muteApplied: AuraEventType;
  };
}

export async function settleVoteTransition(
  tx: Parameters<typeof applyWeightedAward>[0],
  input: SettleVoteTransitionInput
): Promise<VoteOpenPositions> {
  let totalAwarded = input.positions.awardedAura;
  let totalCost = input.positions.mutingCostAura;
  const now = new Date();

  for (const component of decomposeVoteTransition(
    input.oldValue,
    input.newValue
  )) {
    switch (component.kind) {
      case "REMOVE_AMPLIFY": {
        // Refund exactly the amplify gain that was standing, never the mute
        // loss half of the signed field (a vote applies only one side).
        const standingAmplify = Math.max(0, totalAwarded);
        if (standingAmplify !== 0) {
          await reverseExactAura(tx, {
            commentId: input.commentId ?? null,
            issuerId: input.actorId,
            openAmount: standingAmplify,
            postId: input.postId,
            recipientId: input.recipientId,
            type: input.types.amplifyRemoved,
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
          commentId: input.commentId ?? null,
          now,
          postId: input.postId,
          recipientId: input.recipientId,
          subjectToDailyCap: true,
          taperClass: "amplify",
          type: input.types.amplifyApplied,
        });
        totalAwarded += amount;
        break;
      }
      case "APPLY_MUTE": {
        const { amount } = await applyWeightedAward(tx, {
          actor: input.actor,
          actorId: input.actorId,
          baseAmount: -MUTE_RECEIVE_AURA,
          commentId: input.commentId ?? null,
          now,
          postId: input.postId,
          recipientId: input.recipientId,
          subjectToDailyCap: false,
          type: input.types.amplifyRemoved,
        });
        totalAwarded += amount;

        // Every mute costs its issuer, even on their own content.
        const { amount: costAmount } = await chargeMutingCost(tx, {
          commentId: input.commentId ?? null,
          muterId: input.actorId,
          postId: input.postId,
        });
        totalCost += costAmount;
        break;
      }
      case "REMOVE_MUTE": {
        // Give the author back exactly the mute loss that was standing...
        const standingMute = Math.min(0, totalAwarded);
        if (standingMute !== 0) {
          await reverseExactAura(tx, {
            commentId: input.commentId ?? null,
            issuerId: input.actorId,
            openAmount: standingMute,
            postId: input.postId,
            recipientId: input.recipientId,
            type: input.types.amplifyApplied,
          });
        }
        totalAwarded = Math.max(0, totalAwarded);

        // ...and refund the muter's honesty cost in full.
        if (totalCost !== 0) {
          await reverseExactAura(tx, {
            commentId: input.commentId ?? null,
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
