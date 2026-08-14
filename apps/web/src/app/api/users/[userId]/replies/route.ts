import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostData } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export interface UserRepliesPage {
  nextCursor: string | null;
  replies: UserReplyData[];
}

export interface UserReplyData {
  content: string;
  createdAt: Date;
  id: string;
  post: PostData;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
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
    include: {
      post: {
        include: getPostDataInclude(user.id),
      },
      user: {
        select: {
          avatarUrl: true,
          displayName: true,
          id: true,
          username: true,
        },
      },
    },
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
