"use server";

import { createCommentSchema } from "@asm/auth/validation";
import {
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  getCommentDataInclude,
  prisma,
} from "@asm/db";
import type { PostData } from "@asm/db";

// Aura awarded for participating in comment threads. Commenting credits both
// the commenter and (unless it is their own post) the post author.
const COMMENT_CREATION_AURA = 1;
const COMMENT_RECEIVED_AURA = 1;

export async function submitComment({
  post,
  content,
}: {
  post: PostData;
  content: string;
}) {
  const { getSessionFromApi } = await import("@/lib/session");
  const sessionData = await getSessionFromApi();

  if (!sessionData?.user) {
    throw new Error("Unauthorized");
  }

  const { content: contentValidated } = createCommentSchema.parse({ content });

  const isSelfComment = post.user.id === sessionData.user.id;

  const newComment = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        content: contentValidated,
        postId: post.id,
        userId: sessionData.user.id,
      },
      include: getCommentDataInclude(sessionData.user.id),
    });

    await tx.user.update({
      data: { aura: { increment: COMMENT_CREATION_AURA } },
      where: { id: sessionData.user.id },
    });

    await tx.auraLog.create({
      data: {
        amount: COMMENT_CREATION_AURA,
        commentId: comment.id,
        issuerId: sessionData.user.id,
        postId: post.id,
        type: "COMMENT_CREATION",
        userId: sessionData.user.id,
      },
    });

    if (!isSelfComment) {
      await tx.user.update({
        data: { aura: { increment: COMMENT_RECEIVED_AURA } },
        where: { id: post.user.id },
      });

      await tx.auraLog.create({
        data: {
          amount: COMMENT_RECEIVED_AURA,
          commentId: comment.id,
          issuerId: sessionData.user.id,
          postId: post.id,
          type: "COMMENT_RECEIVED",
          userId: post.user.id,
        },
      });

      await tx.notification.create({
        data: {
          issuerId: sessionData.user.id,
          postId: post.id,
          recipientId: post.user.id,
          type: "COMMENT",
        },
      });

      enqueueNotificationCreated(post.user.id).catch((error: unknown) => {
        console.error("Failed to enqueue notification created event:", error);
      });
    }

    return comment;
  });

  return newComment;
}

export async function deleteComment(id: string) {
  const { getSessionFromApi } = await import("@/lib/session");
  const sessionData = await getSessionFromApi();

  if (!sessionData?.user) {
    throw new Error("Unauthorized");
  }

  const comment = await prisma.comment.findUnique({
    where: { id },
  });

  if (!comment) {
    throw new Error("Comment not found");
  }

  if (comment.userId !== sessionData.user.id) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    select: { id: true, userId: true },
    where: { id: comment.postId },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  const isSelfComment = comment.userId === post.userId;

  const deletedComment = await prisma.$transaction(async (tx) => {
    const deleted = await tx.comment.delete({
      include: getCommentDataInclude(sessionData.user.id),
      where: { id },
    });

    // Only reverse aura that was actually awarded (comments created before
    // this feature shipped never earned any).
    const wasAwarded = await tx.auraLog.findFirst({
      where: { commentId: id, type: "COMMENT_CREATION" },
    });

    if (wasAwarded) {
      await tx.user.update({
        data: { aura: { decrement: COMMENT_CREATION_AURA } },
        where: { id: sessionData.user.id },
      });

      await tx.auraLog.create({
        data: {
          amount: -COMMENT_CREATION_AURA,
          commentId: id,
          issuerId: sessionData.user.id,
          postId: comment.postId,
          type: "COMMENT_CREATION",
          userId: sessionData.user.id,
        },
      });

      if (!isSelfComment) {
        await tx.user.update({
          data: { aura: { decrement: COMMENT_RECEIVED_AURA } },
          where: { id: post.userId },
        });

        await tx.auraLog.create({
          data: {
            amount: -COMMENT_RECEIVED_AURA,
            commentId: id,
            issuerId: sessionData.user.id,
            postId: comment.postId,
            type: "COMMENT_RECEIVED",
            userId: post.userId,
          },
        });
      }
    }

    // The notification refers to the deleted comment, so clean it up whether
    // or not aura was ever awarded.
    if (!isSelfComment) {
      await tx.notification.deleteMany({
        where: {
          issuerId: sessionData.user.id,
          postId: comment.postId,
          recipientId: post.userId,
          type: "COMMENT",
        },
      });

      enqueueNotificationDeleted(post.userId).catch((error: unknown) => {
        console.error("Failed to enqueue notification deleted event:", error);
      });
    }

    return deleted;
  });

  return deletedComment;
}
