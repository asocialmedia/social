import {
  communityVisibilityWhere,
  getPostAncestors,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { PostData } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

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
  // A direct post read must honor the same community visibility as every feed:
  // a post inside a PRIVATE community the viewer cannot read is a 404, not a
  // leak of its content through a known id.
  const visibility = communityVisibilityWhere(user.id);
  let post = await prisma.post.findFirst({
    include: getPostDataInclude(user.id),
    where: { id: postId, ...visibility },
  });
  if (!post && postId.length >= 8) {
    const matches = await prisma.post.findMany({
      include: getPostDataInclude(user.id),
      take: 2,
      where: { id: { startsWith: postId }, ...visibility },
    });
    if (matches.length === 1) {
      post = matches[0] ?? null;
    }
  }
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const [hydrated] = await hydrateViewCounts([post]);
  let ancestors: PostData[] = [];
  if (hydrated.parentPostId) {
    ancestors = await getPostAncestors(hydrated.parentPostId, user.id);
  }

  return Response.json({ ancestors, post: hydrated });
}
