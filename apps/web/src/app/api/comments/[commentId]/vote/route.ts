import {
  and,
  findVisibleCommentPost,
  fromPrismaDateTime,
  invalidateAuraSignals,
  prisma,
  settleVoteTransition,
} from "@asm/db";
import type { CommentVoteInfo, PrismaTransaction } from "@asm/db";

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

const VALID_VOTE_VALUES = new Set([-1, 0, 1]);
const MAX_CAS_ATTEMPTS = 8;

async function updateCommentAuraWithCas(
  tx: PrismaTransaction,
  commentId: string,
  delta: number,
  attemptsRemaining = MAX_CAS_ATTEMPTS
): Promise<void> {
  const comment = await tx.orm.public.Comments.select("aura")
    .where({ id: commentId })
    .first();
  if (!comment) {
    return;
  }
  const updated = await tx.orm.public.Comments.where((candidate) =>
    and(candidate.id.eq(commentId), candidate.aura.eq(comment.aura))
  ).updateAndCount({ aura: comment.aura + delta });
  if (updated === 1) {
    return;
  }
  if (attemptsRemaining <= 1) {
    throw new TransactionRetryError();
  }
  return updateCommentAuraWithCas(tx, commentId, delta, attemptsRemaining - 1);
}

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

  // The comment's post must be readable first: this endpoint exposes aura and
  // the viewer's own vote state, which belong to a thread they cannot see.
  const visible = await findVisibleCommentPost(commentId, user.id);
  if (!visible) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  const comment = await prisma.orm.public.Comments.select("aura")
    .where({ id: commentId })
    .first();

  if (!comment) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  const vote = await prisma.orm.public.CommentVotes.select("value")
    .where((candidate) =>
      and(candidate.commentId.eq(commentId), candidate.userId.eq(user.id))
    )
    .first();

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

  // Voting is a state change on the comment's post (aura plus a notification to
  // its author), so the post must be readable before anything is written. A
  // stranger could otherwise move aura inside a community they cannot see.
  if (!(await findVisibleCommentPost(commentId, user.id))) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  let affectedAuthorId: string | null = null;
  try {
    const notificationEvents = newNotificationEvents();
    const result = await runSerializableTransaction(async (tx) => {
      resetNotificationEvents(notificationEvents);
      const comment = await tx.orm.public.Comments.select(
        "aura",
        "id",
        "postId",
        "userId"
      )
        .where({ id: commentId })
        .first();
      if (!comment) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.orm.public.CommentVotes.where((vote) =>
          and(vote.commentId.eq(commentId), vote.userId.eq(user.id))
        ).first(),
        tx.orm.public.Users.select("aura", "createdAt")
          .where({ id: user.id })
          .first(),
      ]);
      if (!actor) {
        return null;
      }

      const oldValue = existingVote?.value ?? 0;
      affectedAuthorId = comment.userId;

      const positions = await settleVoteTransition(tx, {
        actor: {
          aura: actor.aura,
          createdAt: fromPrismaDateTime(actor.createdAt),
        },
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
        types: {
          amplifyApplied: "COMMENT_VOTE",
          amplifyRemoved: "COMMENT_VOTE_REMOVED",
          muteApplied: "COMMENT_VOTE_REMOVED",
        },
      });

      if (value === 0) {
        if (existingVote) {
          const removed = await tx.orm.public.CommentVotes.where((vote) =>
            and(
              vote.commentId.eq(commentId),
              vote.userId.eq(user.id),
              vote.value.eq(oldValue)
            )
          ).deleteAndCount();
          if (removed !== 1) {
            throw new TransactionRetryError();
          }
        }
      } else if (existingVote) {
        const updated = await tx.orm.public.CommentVotes.where((vote) =>
          and(
            vote.commentId.eq(commentId),
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
        await tx.orm.public.CommentVotes.create({
          awardedAura: positions.awardedAura,
          commentId,
          mutingCostAura: positions.mutingCostAura,
          userId: user.id,
          value,
        });
      }

      const auraDelta = value - oldValue;
      if (auraDelta !== 0) {
        await updateCommentAuraWithCas(tx, commentId, auraDelta);
      }

      // Only notify others, never yourself.
      const isSelfVote = comment.userId === user.id;
      let wasAmplified = false;
      let wasAmplifyRemoved = false;
      if (!isSelfVote) {
        if (value === 1 && oldValue !== 1) {
          wasAmplified = true;
          const amplifyNotification = await tx.orm.public.Notifications.select(
            "id"
          ).create({
            _type: "AMPLIFY",
            commentId,
            issuerId: user.id,
            postId: comment.postId,
            recipientId: comment.userId,
          });
          notificationEvents.created.push({
            notificationId: amplifyNotification.id,
            recipientId: comment.userId,
          });
        } else if (value !== 1 && oldValue === 1) {
          wasAmplifyRemoved = true;
          await tx.orm.public.Notifications.where((notification) =>
            and(
              notification.commentId.eq(commentId),
              notification.issuerId.eq(user.id),
              notification.postId.eq(comment.postId),
              notification.recipientId.eq(comment.userId),
              notification._type.eq("AMPLIFY")
            )
          ).delete();
          notificationEvents.deleted.push(comment.userId);
        }
      }

      const updated = await tx.orm.public.Comments.select("aura")
        .where({ id: commentId })
        .first();

      return {
        aura: updated?.aura ?? comment.aura,
        postId: comment.postId,
        userVote: value === 0 ? 0 : value,
        wasAmplified,
        wasAmplifyRemoved,
      };
    });

    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "comment amplify");

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
    const notificationEvents = newNotificationEvents();
    const result = await runSerializableTransaction(async (tx) => {
      resetNotificationEvents(notificationEvents);
      const comment = await tx.orm.public.Comments.select(
        "aura",
        "postId",
        "userId"
      )
        .where({ id: commentId })
        .first();
      if (!comment) {
        return null;
      }

      const [existingVote, actor] = await Promise.all([
        tx.orm.public.CommentVotes.where((vote) =>
          and(vote.commentId.eq(commentId), vote.userId.eq(user.id))
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
        commentId,
        newValue: 0,
        oldValue,
        positions: {
          awardedAura: existingVote?.awardedAura ?? 0,
          mutingCostAura: existingVote?.mutingCostAura ?? 0,
        },
        postId: comment.postId,
        recipientId: comment.userId,
        types: {
          amplifyApplied: "COMMENT_VOTE",
          amplifyRemoved: "COMMENT_VOTE_REMOVED",
          muteApplied: "COMMENT_VOTE_REMOVED",
        },
      });

      if (existingVote) {
        const removed = await tx.orm.public.CommentVotes.where((vote) =>
          and(
            vote.commentId.eq(commentId),
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
        await updateCommentAuraWithCas(tx, commentId, auraDelta);
      }

      // Only notify others, never yourself.
      const isSelfVote = comment.userId === user.id;
      if (oldValue === 1 && !isSelfVote) {
        await tx.orm.public.Notifications.where((notification) =>
          and(
            notification.commentId.eq(commentId),
            notification.issuerId.eq(user.id),
            notification.postId.eq(comment.postId),
            notification.recipientId.eq(comment.userId),
            notification._type.eq("AMPLIFY")
          )
        ).delete();
        notificationEvents.deleted.push(comment.userId);
      }

      const updated = await tx.orm.public.Comments.select("aura")
        .where({ id: commentId })
        .first();

      return { aura: updated?.aura ?? comment.aura, userVote: 0 };
    });

    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "comment amplify");

    if (!result) {
      return Response.json({ error: "Comment not found" }, { status: 404 });
    }

    return Response.json(result satisfies CommentVoteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
