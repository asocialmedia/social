import {
  and,
  fromPrismaDateTime,
  getPostDataQuery,
  invalidateAuraSignals,
  invalidateFypProfile,
  mapPostData,
  prisma,
  settleVoteTransition,
} from "@asm/db";
import type { PostData, PrismaTransaction } from "@asm/db";

import {
  runSerializableTransaction,
  TransactionRetryError,
} from "@/lib/aura/db-transactions";
import { getSessionFromApi } from "@/lib/auth/session";
import {
  flushNotificationEvents,
  newNotificationEvents,
  resetNotificationEvents,
} from "@/lib/notifications/deferred-events";
import { recordRecommendationInteraction } from "@/lib/recommendations/record-event";
import { suggestedUsersCache } from "@/lib/users/suggested-users-cache";

interface VoteInfo {
  aura: number;
  userVote: number;
}

const VALID_VOTE_VALUES = new Set([-1, 0, 1]);
const MAX_CAS_ATTEMPTS = 8;

async function updatePostAuraWithCas(
  tx: PrismaTransaction,
  postId: string,
  delta: number,
  attemptsRemaining = MAX_CAS_ATTEMPTS
): Promise<void> {
  const post = await tx.orm.public.Posts.select("aura")
    .where({ id: postId })
    .first();
  if (!post) {
    return;
  }
  const updated = await tx.orm.public.Posts.where((candidate) =>
    and(candidate.id.eq(postId), candidate.aura.eq(post.aura))
  ).updateAndCount({ aura: post.aura + delta });
  if (updated === 1) {
    return;
  }
  if (attemptsRemaining <= 1) {
    throw new TransactionRetryError();
  }
  return updatePostAuraWithCas(tx, postId, delta, attemptsRemaining - 1);
}

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

    const postRow = await getPostDataQuery(prisma.orm, user.id)
      .where({ id: postId })
      .first();
    const post = postRow ? mapPostData(postRow) : null;

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    const voteInfo: VoteInfo = {
      aura: post.aura,
      userVote: post.vote?.[0]?.value ?? 0,
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
    const notificationEvents = newNotificationEvents();
    const result = await runSerializableTransaction(async (tx) => {
      resetNotificationEvents(notificationEvents);
      auraChanged = false;
      const post = await tx.orm.public.Posts.select("id", "userId")
        .where({ id: postId })
        .first();
      if (!post) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.orm.public.Votes.where((vote) =>
          and(vote.postId.eq(postId), vote.userId.eq(user.id))
        ).first(),
        tx.orm.public.Users.select("aura", "createdAt")
          .where({ id: user.id })
          .first(),
      ]);
      if (!actor) {
        return null;
      }

      const oldValue = existingVote?.value ?? 0;

      const positions = await settleVoteTransition(tx, {
        actor: {
          aura: actor.aura,
          createdAt: fromPrismaDateTime(actor.createdAt),
        },
        actorId: user.id,
        newValue: value,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId,
        recipientId: post.userId,
        types: {
          amplifyApplied: "POST_VOTE",
          amplifyRemoved: "POST_VOTE_REMOVED",
          muteApplied: "POST_VOTE_REMOVED",
        },
      });

      if (value === 0) {
        if (existingVote) {
          const removed = await tx.orm.public.Votes.where((vote) =>
            and(
              vote.postId.eq(postId),
              vote.userId.eq(user.id),
              vote.value.eq(oldValue)
            )
          ).deleteAndCount();
          if (removed !== 1) {
            throw new TransactionRetryError();
          }
        }
      } else if (existingVote) {
        const updated = await tx.orm.public.Votes.where((vote) =>
          and(
            vote.postId.eq(postId),
            vote.userId.eq(user.id),
            vote.value.eq(oldValue)
          )
        ).updateAndCount({
          awardedAura: positions.awardedAura,
          mutingCostAura: positions.mutingCostAura,
          value,
        });
        if (updated !== 1) {
          throw new TransactionRetryError();
        }
      } else {
        await tx.orm.public.Votes.create({
          awardedAura: positions.awardedAura,
          mutingCostAura: positions.mutingCostAura,
          postId,
          userId: user.id,
          value,
        });
      }

      const auraDelta = value - oldValue;
      if (auraDelta !== 0) {
        auraChanged = true;
        await updatePostAuraWithCas(tx, postId, auraDelta);
      }

      // Only notify others, never yourself.
      const isSelfVote = post.userId === user.id;
      if (!isSelfVote) {
        if (value === 1 && oldValue !== 1) {
          const amplifyNotification = await tx.orm.public.Notifications.select(
            "id"
          ).create({
            _type: "AMPLIFY",
            issuerId: user.id,
            postId,
            recipientId: post.userId,
          });
          notificationEvents.created.push({
            notificationId: amplifyNotification.id,
            recipientId: post.userId,
          });
        } else if (value !== 1 && oldValue === 1) {
          await tx.orm.public.Notifications.where((notification) =>
            and(
              notification.issuerId.eq(user.id),
              notification.postId.eq(postId),
              notification.recipientId.eq(post.userId),
              notification._type.eq("AMPLIFY")
            )
          ).delete();
          notificationEvents.deleted.push(post.userId);
        }
      }

      const resultRow = await getPostDataQuery(tx.orm, user.id)
        .where({ id: postId })
        .first();
      return resultRow ? mapPostData(resultRow) : null;
    });

    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "amplify");

    if (!result) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    // The vote is one of the strongest personalized-feed signals. Expire the
    // actor's persona immediately so the next feed request reflects it.
    void invalidateFypProfile(user.id);
    if (value === 1) {
      void recordRecommendationInteraction({
        eventType: "VOTE",
        postId,
        userId: user.id,
      });
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
      userVote: result.vote?.[0]?.value ?? 0,
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
    const notificationEvents = newNotificationEvents();
    const result = await runSerializableTransaction(async (tx) => {
      resetNotificationEvents(notificationEvents);
      auraChanged = false;
      const post = await tx.orm.public.Posts.select("id", "userId")
        .where({ id: postId })
        .first();
      if (!post) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.orm.public.Votes.where((vote) =>
          and(vote.postId.eq(postId), vote.userId.eq(user.id))
        ).first(),
        tx.orm.public.Users.select("aura", "createdAt")
          .where({ id: user.id })
          .first(),
      ]);
      if (!actor) {
        return null;
      }

      const oldValue = existingVote?.value ?? 0;

      await settleVoteTransition(tx, {
        actor: {
          aura: actor.aura,
          createdAt: fromPrismaDateTime(actor.createdAt),
        },
        actorId: user.id,
        newValue: 0,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId,
        recipientId: post.userId,
        types: {
          amplifyApplied: "POST_VOTE",
          amplifyRemoved: "POST_VOTE_REMOVED",
          muteApplied: "POST_VOTE_REMOVED",
        },
      });

      if (existingVote) {
        const removed = await tx.orm.public.Votes.where((vote) =>
          and(
            vote.postId.eq(postId),
            vote.userId.eq(user.id),
            vote.value.eq(oldValue)
          )
        ).deleteAndCount();
        if (removed !== 1) {
          throw new TransactionRetryError();
        }
      }

      const auraDelta = 0 - oldValue;
      if (auraDelta !== 0) {
        auraChanged = true;
        await updatePostAuraWithCas(tx, postId, auraDelta);
      }

      // Only notify others, never yourself.
      const isSelfVote = post.userId === user.id;
      if (oldValue === 1 && !isSelfVote) {
        await tx.orm.public.Notifications.where((notification) =>
          and(
            notification.issuerId.eq(user.id),
            notification.postId.eq(postId),
            notification.recipientId.eq(post.userId),
            notification._type.eq("AMPLIFY")
          )
        ).delete();
        notificationEvents.deleted.push(post.userId);
      }

      const resultRow = await getPostDataQuery(tx.orm, user.id)
        .where({ id: postId })
        .first();
      return resultRow ? mapPostData(resultRow) : null;
    });

    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "amplify");

    if (!result) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    void invalidateFypProfile(user.id);

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
