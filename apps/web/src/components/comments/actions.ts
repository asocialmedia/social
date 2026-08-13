"use server";

import { createCommentSchema } from "@asm/auth/validation";
import {
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  getCommentDataInclude,
  type PostData,
  prisma,
} from "@asm/db";

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
      where: { id: sessionData.user.id },
      data: { aura: { increment: COMMENT_CREATION_AURA } },
    });

    await tx.auraLog.create({
      data: {
        userId: sessionData.user.id,
        issuerId: sessionData.user.id,
        amount: COMMENT_CREATION_AURA,
        type: "COMMENT_CREATION",
        postId: post.id,
        commentId: comment.id,
      },
    });

    if (!isSelfComment) {
      await tx.user.update({
        where: { id: post.user.id },
        data: { aura: { increment: COMMENT_RECEIVED_AURA } },
      });

      await tx.auraLog.create({
        data: {
          userId: post.user.id,
          issuerId: sessionData.user.id,
          amount: COMMENT_RECEIVED_AURA,
          type: "COMMENT_RECEIVED",
          postId: post.id,
          commentId: comment.id,
        },
      });

      await tx.notification.create({
        data: {
          issuerId: sessionData.user.id,
          recipientId: post.user.id,
          postId: post.id,
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
    where: { id: comment.postId },
    select: { id: true, userId: true },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  const isSelfComment = comment.userId === post.userId;

  const deletedComment = await prisma.$transaction(async (tx) => {
    const deleted = await tx.comment.delete({
      where: { id },
      include: getCommentDataInclude(sessionData.user.id),
    });

    // Only reverse aura that was actually awarded (comments created before
    // this feature shipped never earned any).
    const wasAwarded = await tx.auraLog.findFirst({
      where: { commentId: id, type: "COMMENT_CREATION" },
    });

    if (wasAwarded) {
      await tx.user.update({
        where: { id: sessionData.user.id },
        data: { aura: { decrement: COMMENT_CREATION_AURA } },
      });

      await tx.auraLog.create({
        data: {
          userId: sessionData.user.id,
          issuerId: sessionData.user.id,
          amount: -COMMENT_CREATION_AURA,
          type: "COMMENT_CREATION",
          postId: comment.postId,
          commentId: id,
        },
      });

      if (!isSelfComment) {
        await tx.user.update({
          where: { id: post.userId },
          data: { aura: { decrement: COMMENT_RECEIVED_AURA } },
        });

        await tx.auraLog.create({
          data: {
            userId: post.userId,
            issuerId: sessionData.user.id,
            amount: -COMMENT_RECEIVED_AURA,
            type: "COMMENT_RECEIVED",
            postId: comment.postId,
            commentId: id,
          },
        });
      }
    }

    // The notification refers to the deleted comment, so clean it up whether
    // or not aura was ever awarded.
    if (!isSelfComment) {
      await tx.notification.deleteMany({
        where: {
          type: "COMMENT",
          recipientId: post.userId,
          issuerId: sessionData.user.id,
          postId: comment.postId,
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
