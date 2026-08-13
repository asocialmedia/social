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
    data: { postId, userId: user.id, content },
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
    where: { postId },
    orderBy: { createdAt: "desc" },
    include: getCommentDataInclude(user.id),
  });

  return Response.json({
    comments,
    previousCursor: null, // For now, no pagination
  });
}
