import { getCommentDataInclude, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await ctx.params;
  const { content } = await request.json();
  const comment = await prisma.comment.create({
    data: { content, postId, userId: user.id },
  });
  return Response.json(comment);
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await ctx.params;
  const comments = await prisma.comment.findMany({
    include: getCommentDataInclude(user.id),
    orderBy: { createdAt: "desc" },
    where: { postId },
  });

  return Response.json({
    comments,
    previousCursor: null, // For now, no pagination
  });
}
