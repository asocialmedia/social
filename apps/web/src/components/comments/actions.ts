"use server";

import type { CommentData, PostData } from "@asm/db";

import { createComment, softDeleteComment } from "./comment-service";

export async function submitComment({
  post,
  content,
  mediaIds,
  parentId,
}: {
  post: PostData;
  content: string;
  mediaIds?: string[];
  parentId?: string;
}): Promise<CommentData> {
  const { getSessionFromApi } = await import("@/lib/session");
  const sessionData = await getSessionFromApi();

  if (!sessionData?.user) {
    throw new Error("Unauthorized");
  }

  return await createComment({
    content,
    mediaIds,
    parentId,
    postId: post.id,
    userId: sessionData.user.id,
  });
}

export async function deleteComment(id: string): Promise<CommentData> {
  const { getSessionFromApi } = await import("@/lib/session");
  const sessionData = await getSessionFromApi();

  if (!sessionData?.user) {
    throw new Error("Unauthorized");
  }

  return await softDeleteComment(id, sessionData.user.id);
}
