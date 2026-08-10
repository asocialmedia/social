"use server";

import {
  getPostDataInclude,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
} from "@asm/db";
import { authClient } from "@/lib/auth";

export async function deletePost(id: string) {
  const session = await authClient.getSession();

  if (!session?.data?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  if (post.userId !== session.data.user.id) {
    throw new Error("Unauthorized");
  }

  const deletedPost = await prisma.post.delete({
    where: { id },
    include: getPostDataInclude(session.data.user.id),
  });

  try {
    await Promise.all([
      redis.srem(POST_VIEWS_SET, id),
      redis.del(`${POST_VIEWS_KEY_PREFIX}${id}`),
    ]);
  } catch (error) {
    console.error("Error cleaning up Redis cache for deleted post:", error);
  }

  return deletedPost;
}
