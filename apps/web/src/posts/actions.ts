"use server";

import {
  enqueuePostDeleted,
  getPostDataInclude,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
} from "@asm/db";
import { updateTag } from "next/cache";

import { getSessionFromApi } from "@/lib/session";

export interface PostModerationChanges {
  explicitContent?: boolean;
  moderated?: boolean;
}

// Admins can moderate any post; the author can flag their own. Both flags are
// reversible - a moderated post stays in the DB and can be restored, and the
// explicit gate can be lifted - so this is an update, never a delete.
export async function updatePostModeration(
  id: string,
  changes: PostModerationChanges
) {
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    select: { id: true, userId: true },
    where: { id },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  const isOwner = post.userId === session.user.id;
  const isAdmin = session.user.role === "admin";
  if (!isOwner && !isAdmin) {
    throw new Error("Unauthorized");
  }

  const updated = await prisma.post.update({
    data: changes,
    include: getPostDataInclude(session.user.id),
    where: { id },
  });

  // Expire the cached OG card + media rows so the moderation state is reflected
  // on share cards and media pages (read-your-own-writes).
  updateTag("og-post-card");
  updateTag("media-row");

  return updated;
}

export async function deletePost(id: string) {
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  if (post.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  const deletedPost = await prisma.post.delete({
    include: getPostDataInclude(session.user.id),
    where: { id },
  });

  try {
    await Promise.all([
      redis.srem(POST_VIEWS_SET, id),
      redis.del(`${POST_VIEWS_KEY_PREFIX}${id}`),
    ]);
  } catch (error) {
    console.error("Error cleaning up Redis cache for deleted post:", error);
  }

  // The worker deletes the post's media objects + rows (fixes the orphaned
  // media leak caused by the SetNull FK).
  try {
    await enqueuePostDeleted(id);
  } catch (error) {
    console.error("Failed to enqueue post-deleted event:", error);
  }

  // Expire the cached OG card + media rows immediately so a deleted post's
  // share card and media URLs stop being served (read-your-own-writes).
  updateTag("og-post-card");
  updateTag("media-row");

  return deletedPost;
}
