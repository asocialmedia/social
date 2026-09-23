import type { Prisma } from "../../prisma/generated/prisma/client";
import { communityVisibilityWhere } from "../communities/visibility";
import prisma from "../prisma";

// Every read or write keyed by a post id must first prove the post is visible to
// the viewer.
//
// communityVisibilityWhere only ever reaches a query when a caller applies it,
// and the derived endpoints (comments, responses, votes) historically did not:
// they looked the post up by raw id, so a guessed id reached a post inside a
// PRIVATE community. Returning null for both "missing" and "not readable" keeps
// the caller's single 404 from confirming that the post exists.
export interface VisiblePost {
  id: string;
  parentPostId: string | null;
  userId: string;
}

export function findVisiblePost(
  postId: string,
  loggedInUserId: string
): Promise<VisiblePost | null> {
  return prisma.post.findFirst({
    select: { id: true, parentPostId: true, userId: true },
    where: { id: postId, ...communityVisibilityWhere(loggedInUserId) },
  });
}

// The same gate for anything keyed by a COMMENT id: resolve the comment's post
// and check that the viewer may read it. Used by vote/like paths so a stranger
// cannot act on a thread inside a community they cannot see.
export async function findVisibleCommentPost(
  commentId: string,
  loggedInUserId: string
): Promise<{ commentUserId: string; postId: string } | null> {
  const comment = await prisma.comment.findUnique({
    select: { postId: true, userId: true },
    where: { id: commentId },
  });
  if (!comment) {
    return null;
  }
  const post = await prisma.post.findFirst({
    select: { id: true },
    where: { id: comment.postId, ...communityVisibilityWhere(loggedInUserId) },
  });
  if (!post) {
    return null;
  }
  return { commentUserId: comment.userId, postId: comment.postId };
}

export type PostVisibilityFilter = Prisma.PostWhereInput;
