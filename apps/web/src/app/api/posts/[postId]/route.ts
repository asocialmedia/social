import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  // The embed path (message threads) is only reachable by signed-in users, so
  // a guest hitting this route has nothing to see. Require auth instead of
  // falling back to an empty user id.
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await ctx.params;
  let post = await prisma.post.findUnique({
    include: getPostDataInclude(user.id),
    where: { id: postId },
  });
  if (!post && postId.length >= 8) {
    post = await prisma.post.findFirst({
      include: getPostDataInclude(user.id),
      where: { id: { startsWith: postId } },
    });
  }
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const [hydrated] = await hydrateViewCounts([post]);
  return Response.json({ post: hydrated });
}
