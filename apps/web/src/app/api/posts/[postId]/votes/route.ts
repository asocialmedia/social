import {
  AMPLIFY_RECEIVE_AURA,
  applyWeightedAward,
  chargeMutingCost,
  decomposeVoteTransition,
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  getPostDataInclude,
  invalidateAuraSignals,
  MUTE_RECEIVE_AURA,
  prisma,
  reverseExactAura,
} from "@asm/db";
import type { Prisma, PostData } from "@asm/db";

import { runSerializableTransaction } from "@/lib/db-transactions";
import { getSessionFromApi } from "@/lib/session";
import { suggestedUsersCache } from "@/lib/suggested-users-cache";

interface VoteInfo {
  aura: number;
  userVote: number;
}

// Open economy positions carried by a vote row. awardedAura is the signed net
// author-side amount currently applied (+amplify gain / -mute loss);
// mutingCostAura is the muter honesty cost currently charged (always <= 0).
interface OpenPositions {
  awardedAura: number;
  mutingCostAura: number;
}

const VALID_VOTE_VALUES = new Set([-1, 0, 1]);

// Settles the economy events of one vote transition against the open
// positions stored on the existing vote row, returning the new totals to
// persist. Removals reverse EXACTLY what is standing (weighting made amounts
// vary over time), applications go through the weighted/tapered/capped award
// pipeline. Self-engagement is zeroed inside the engine; self-mutes still
// pay the muting cost.
// oxlint-disable no-await-in-loop -- transition components share running totals and must settle strictly in order
async function settleVoteEconomy(
  tx: Prisma.TransactionClient,
  input: {
    actor: { aura: number; createdAt: Date };
    actorId: string;
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
        // Refund exactly the amplify gain that was standing, never the mute
        // loss half of the signed field (a vote applies only one side).
        const standingAmplify = Math.max(0, totalAwarded);
        if (standingAmplify !== 0) {
          await reverseExactAura(tx, {
            issuerId: input.actorId,
            openAmount: standingAmplify,
            postId: input.postId,
            recipientId: input.recipientId,
            type: "POST_VOTE_REMOVED",
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
          now,
          postId: input.postId,
          recipientId: input.recipientId,
          subjectToDailyCap: true,
          taperClass: "amplify",
          type: "POST_VOTE",
        });
        totalAwarded += amount;
        break;
      }
      case "APPLY_MUTE": {
        const { amount } = await applyWeightedAward(tx, {
          actor: input.actor,
          actorId: input.actorId,
          baseAmount: -MUTE_RECEIVE_AURA,
          now,
          postId: input.postId,
          recipientId: input.recipientId,
          subjectToDailyCap: false,
          type: "POST_VOTE_REMOVED",
        });
        totalAwarded += amount;

        // Every mute costs its issuer, even on their own content.
        const { amount: costAmount } = await chargeMutingCost(tx, {
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
            issuerId: input.actorId,
            openAmount: standingMute,
            postId: input.postId,
            recipientId: input.recipientId,
            type: "POST_VOTE",
          });
        }
        totalAwarded = Math.max(0, totalAwarded);

        // ...and refund the muter's honesty cost in full.
        if (totalCost !== 0) {
          await reverseExactAura(tx, {
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
  props: { params: Promise<{ postId: string }> }
) {
  const params = await props.params;
  const { postId } = params;

  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      include: getPostDataInclude(user.id),
      where: { id: postId },
    });

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    const voteInfo: VoteInfo = {
      aura: post.aura,
      userVote: post.vote[0]?.value || 0,
    };

    const postData: PostData & VoteInfo = {
      ...post,
      ...voteInfo,
    };

    return Response.json(postData);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { value } = (await request.json()) as { value?: number };
  if (typeof value !== "number" || !VALID_VOTE_VALUES.has(value)) {
    return Response.json({ error: "Invalid vote value" }, { status: 400 });
  }

  let auraChanged = false;
  try {
    // Serializable + retry: a concurrent vote must re-read the committed
    // state instead of double-applying the aura delta (READ COMMITTED lets
    // both writers observe the same pre-race value).
    const result = await runSerializableTransaction(async (tx) => {
      const post = await tx.post.findUnique({
        select: { id: true, userId: true },
        where: { id: postId },
      });
      if (!post) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.vote.findUnique({
          where: { userId_postId: { postId, userId: user.id } },
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

      const positions = await settleVoteEconomy(tx, {
        actor: { aura: actor.aura, createdAt: actor.createdAt },
        actorId: user.id,
        newValue: value,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId,
        recipientId: post.userId,
      });

      if (value === 0) {
        if (existingVote) {
          await tx.vote.delete({
            where: { userId_postId: { postId, userId: user.id } },
          });
        }
      } else {
        await tx.vote.upsert({
          create: {
            awardedAura: positions.awardedAura,
            mutingCostAura: positions.mutingCostAura,
            postId,
            userId: user.id,
            value,
          },
          update: {
            awardedAura: positions.awardedAura,
            mutingCostAura: positions.mutingCostAura,
            value,
          },
          where: { userId_postId: { postId, userId: user.id } },
        });
      }

      // Raw score keeps +-1-per-vote semantics; only User.aura is weighted.
      const auraDelta = value - oldValue;
      if (auraDelta !== 0) {
        auraChanged = true;
        await tx.post.update({
          data: { aura: { increment: auraDelta } },
          where: { id: postId },
        });
      }

      // Only notify others, never yourself.
      const isSelfVote = post.userId === user.id;
      if (!isSelfVote) {
        if (value === 1 && oldValue !== 1) {
          await tx.notification.create({
            data: {
              issuerId: user.id,
              postId,
              recipientId: post.userId,
              type: "AMPLIFY",
            },
          });
          enqueueNotificationCreated(post.userId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue amplify notification event:",
              error
            );
          });
        } else if (value !== 1 && oldValue === 1) {
          await tx.notification.deleteMany({
            where: {
              issuerId: user.id,
              postId,
              recipientId: post.userId,
              type: "AMPLIFY",
            },
          });
          enqueueNotificationDeleted(post.userId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue amplify removal notification event:",
              error
            );
          });
        }
      }

      return await tx.post.findUnique({
        include: getPostDataInclude(user.id),
        where: { id: postId },
      });
    });

    if (!result) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (auraChanged) {
      await suggestedUsersCache.invalidateForUser(result.userId);
      // Fire-and-forget: signals serve ranking heuristics and fall back to a
      // TTL refresh, so a failed invalidation only costs freshness.
      try {
        await invalidateAuraSignals([result.userId, user.id]);
      } catch (error) {
        console.error("Failed to invalidate aura signals:", error);
      }
    }

    const voteInfo: VoteInfo = {
      aura: result.aura,
      userVote: result.vote[0]?.value || 0,
    };

    return Response.json(voteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let auraChanged = false;
  try {
    const result = await runSerializableTransaction(async (tx) => {
      const post = await tx.post.findUnique({
        select: { id: true, userId: true },
        where: { id: postId },
      });
      if (!post) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.vote.findUnique({
          where: { userId_postId: { postId, userId: user.id } },
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

      await settleVoteEconomy(tx, {
        actor: { aura: actor.aura, createdAt: actor.createdAt },
        actorId: user.id,
        newValue: 0,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId,
        recipientId: post.userId,
      });

      if (existingVote) {
        await tx.vote.delete({
          where: { userId_postId: { postId, userId: user.id } },
        });
      }

      const auraDelta = 0 - oldValue;
      if (auraDelta !== 0) {
        auraChanged = true;
        await tx.post.update({
          data: { aura: { increment: auraDelta } },
          where: { id: postId },
        });
      }

      // Only notify others, never yourself.
      const isSelfVote = post.userId === user.id;
      if (oldValue === 1 && !isSelfVote) {
        await tx.notification.deleteMany({
          where: {
            issuerId: user.id,
            postId,
            recipientId: post.userId,
            type: "AMPLIFY",
          },
        });
        enqueueNotificationDeleted(post.userId).catch((error: unknown) => {
          console.error(
            "Failed to enqueue amplify removal notification event:",
            error
          );
        });
      }

      return await tx.post.findUnique({
        include: getPostDataInclude(user.id),
        where: { id: postId },
      });
    });

    if (!result) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (auraChanged) {
      await suggestedUsersCache.invalidateForUser(result.userId);
      try {
        await invalidateAuraSignals([result.userId, user.id]);
      } catch (error) {
        console.error("Failed to invalidate aura signals:", error);
      }
    }

    const voteInfo: VoteInfo = {
      aura: result.aura,
      userVote: 0,
    };

    return Response.json(voteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
