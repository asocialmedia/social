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
  // Guests can read a public post: the web detail page already serves them via
  // a direct Prisma read, and the sibling related/comments routes allow the
  // same. Resolving per-user fields against an empty id keeps the reply
  // guest-shaped (no vote/bookmark state) without a second code path.
  const userId = session?.user?.id ?? "";

  const { postId } = await ctx.params;
  // A direct post read must honor the same community visibility as every feed:
  // a post inside a PRIVATE community the viewer cannot read is a 404, not a
  // leak of its content through a known id. For a guest that means public
  // communities only.
  const visibility = communityVisibilityWhere(userId);
  let post = await prisma.post.findFirst({
    include: getPostDataInclude(userId),
    where: { id: postId, ...visibility },
  });
  if (!post && postId.length >= 8) {
    const matches = await prisma.post.findMany({
      include: getPostDataInclude(userId),
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
    ancestors = await getPostAncestors(hydrated.parentPostId, userId);
  }

  return Response.json({ ancestors, post: hydrated });
}
