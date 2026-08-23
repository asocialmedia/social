import {
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  prisma,
} from "@asm/db";
import type { CommentVoteInfo } from "@asm/db";

import { runSerializableTransaction } from "@/lib/db-transactions";
import { getSessionFromApi } from "@/lib/session";

const VALID_VOTE_VALUES = new Set([-1, 0, 1]);

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

  try {
    // Serializable + retry so a concurrent vote re-reads committed state
    // instead of double-applying the aura delta.
    const result = await runSerializableTransaction(async (tx) => {
      const comment = await tx.comment.findUnique({
        select: { aura: true, id: true, postId: true, userId: true },
        where: { id: commentId },
      });
      if (!comment) {
        return null;
      }

      const existingVote = await tx.commentVote.findUnique({
        where: { userId_commentId: { commentId, userId: user.id } },
      });
      const oldValue = existingVote?.value || 0;

      if (value === 0) {
        if (existingVote) {
          await tx.commentVote.delete({
            where: { userId_commentId: { commentId, userId: user.id } },
          });
        }
      } else {
        await tx.commentVote.upsert({
          create: { commentId, userId: user.id, value },
          update: { value },
          where: { userId_commentId: { commentId, userId: user.id } },
        });
      }

      // Aura follows the vote score: amplifying (+1) credits aura, muting (-1)
      // or removing a vote debits it. Self-votes award aura too - an amplify
      // on your own eddy still represents reputation for that content.
      const isSelfVote = comment.userId === user.id;
      const auraDelta = value - oldValue;
      if (auraDelta !== 0) {
        await Promise.all([
          tx.comment.update({
            data: { aura: { increment: auraDelta } },
            where: { id: commentId },
          }),
          tx.user.update({
            data: { aura: { increment: auraDelta } },
            where: { id: comment.userId },
          }),
        ]);

        await tx.auraLog.create({
          data: {
            amount: auraDelta,
            commentId,
            issuerId: user.id,
            postId: comment.postId,
            type: auraDelta > 0 ? "COMMENT_VOTE" : "COMMENT_VOTE_REMOVED",
            userId: comment.userId,
          },
        });
      }

      // Only notify others, never yourself.
      if (!isSelfVote) {
        if (value === 1 && oldValue !== 1) {
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
          await tx.notification.deleteMany({
            where: {
              commentId,
              issuerId: user.id,
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
        wasAmplified: value === 1 && oldValue !== 1 && !isSelfVote,
        wasAmplifyRemoved: value !== 1 && oldValue === 1 && !isSelfVote,
      };
    });

    if (!result) {
      return Response.json({ error: "Comment not found" }, { status: 404 });
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

      const existingVote = await tx.commentVote.findUnique({
        where: { userId_commentId: { commentId, userId: user.id } },
      });
      const oldValue = existingVote?.value || 0;

      if (existingVote) {
        await tx.commentVote.delete({
          where: { userId_commentId: { commentId, userId: user.id } },
        });
      }

      const isSelfVote = comment.userId === user.id;

      if (oldValue !== 0) {
        // Only reverse aura that was actually awarded.
        const wasAwarded = await tx.auraLog.findFirst({
          where: {
            commentId,
            issuerId: user.id,
            type: { in: ["COMMENT_VOTE", "COMMENT_VOTE_REMOVED"] },
          },
        });

        if (wasAwarded) {
          await Promise.all([
            tx.comment.update({
              data: { aura: { decrement: oldValue } },
              where: { id: commentId },
            }),
            tx.user.update({
              data: { aura: { decrement: oldValue } },
              where: { id: comment.userId },
            }),
          ]);

          await tx.auraLog.create({
            data: {
              amount: -oldValue,
              commentId,
              issuerId: user.id,
              postId: comment.postId,
              type: "COMMENT_VOTE_REMOVED",
              userId: comment.userId,
            },
          });
        }
      }

      if (oldValue === 1 && !isSelfVote) {
        await tx.notification.deleteMany({
          where: {
            commentId,
            issuerId: user.id,
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
