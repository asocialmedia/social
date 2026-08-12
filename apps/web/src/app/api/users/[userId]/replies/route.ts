import { getPostDataInclude, type PostData, prisma } from "@asm/db";
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
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
      post: {
        include: getPostDataInclude(user.id),
      },
    },
    take: pageSize + 1,
    cursor: cursor ? { id: cursor } : undefined,
  });

  const nextCursor = comments.length > pageSize ? comments[pageSize].id : null;
  const data: UserRepliesPage = {
    replies: comments.slice(0, pageSize),
    nextCursor,
  };
  return Response.json(data);
}
