"use server";

import {
  enqueuePostDeleted,
  getPostDataInclude,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
} from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

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
    where: { id },
    include: getPostDataInclude(session.user.id),
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
  enqueuePostDeleted(id).catch((error: unknown) => {
    console.error("Failed to enqueue post-deleted event:", error);
  });

  return deletedPost;
}
