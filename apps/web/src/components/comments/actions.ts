"use server";

import { createCommentSchema } from "@asm/auth/validation";
import { getCommentDataInclude, type PostData, prisma } from "@asm/db";

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

  const [newComment] = await prisma.$transaction([
    prisma.comment.create({
      data: {
        content: contentValidated,
        postId: post.id,
        userId: sessionData.user.id,
      },
      include: getCommentDataInclude(sessionData.user.id),
    }),
    ...(post.user.id === sessionData.user.id
      ? []
      : [
          prisma.notification.create({
            data: {
              issuerId: sessionData.user.id,
              recipientId: post.user.id,
              postId: post.id,
              type: "COMMENT",
            },
          }),
        ]),
  ]);

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

  const deletedComment = await prisma.comment.delete({
    where: { id },
    include: getCommentDataInclude(sessionData.user.id),
  });

  return deletedComment;
}
