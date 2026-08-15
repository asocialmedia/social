import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const { postId } = await ctx.params;
  const post = await prisma.post.findUnique({
    include: getPostDataInclude(userId),
    where: { id: postId },
  });
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const [hydrated] = await hydrateViewCounts([post]);
  return Response.json({ post: hydrated });
}
