import { and } from "@prisma/orm-postgres/orm-client";

import { communityVisibilityWhere } from "../communities/visibility";
import prisma from "../prisma";

export interface VisiblePost {
  id: string;
  parentPostId: string | null;
  userId: string;
}

export function findVisiblePost(
  postId: string,
  loggedInUserId: string
): Promise<VisiblePost | null> {
  return prisma.orm.public.Posts.select("id", "parentPostId", "userId")
    .where((post) =>
      and(post.id.eq(postId), communityVisibilityWhere(loggedInUserId)(post))
    )
    .first();
}

export async function findVisibleCommentPost(
  commentId: string,
  loggedInUserId: string
): Promise<{ commentUserId: string; postId: string } | null> {
  const comment = await prisma.orm.public.Comments.select("postId", "userId")
    .where({ id: commentId })
    .first();
  if (!comment) {
    return null;
  }
  const post = await prisma.orm.public.Posts.select("id")
    .where((candidate) =>
      and(
        candidate.id.eq(comment.postId),
        communityVisibilityWhere(loggedInUserId)(candidate)
      )
    )
    .first();
  if (!post) {
    return null;
  }
  return { commentUserId: comment.userId, postId: comment.postId };
}

export type PostVisibilityFilter = ReturnType<typeof communityVisibilityWhere>;
