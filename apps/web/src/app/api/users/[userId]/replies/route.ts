import {
  getCommentDataInclude,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export function getReplyDataInclude(loggedInUserId: string) {
  return {
    ...getCommentDataInclude(loggedInUserId),
    // The author of the comment being replied to (or null for a top-level
    // eddy), so the feed can render the "Replying to @user" context line.
    parent: {
      select: {
        user: {
          select: {
            username: true,
          },
        },
      },
    },
    post: {
      include: getPostDataInclude(loggedInUserId),
    },
  } satisfies Prisma.CommentInclude;
}

export type UserReplyData = Prisma.CommentGetPayload<{
  include: ReturnType<typeof getReplyDataInclude>;
}>;

export interface UserRepliesPage {
  nextCursor: string | null;
  replies: UserReplyData[];
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;
  const { userId } = await ctx.params;

  const comments = await prisma.comment.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getReplyDataInclude(user.id),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    where: { userId },
  });

  const replies = comments.slice(0, pageSize);
  const hydratedPosts = await hydrateViewCounts(
    replies.map((reply) => reply.post)
  );

  const repliesWithHydratedPosts = replies.map((reply, index) => ({
    ...reply,
    post: hydratedPosts[index] ?? reply.post,
  }));

  const nextCursor = comments.length > pageSize ? comments[pageSize].id : null;
  const data: UserRepliesPage = {
    nextCursor,
    replies: repliesWithHydratedPosts,
  };
  return Response.json(data);
}
