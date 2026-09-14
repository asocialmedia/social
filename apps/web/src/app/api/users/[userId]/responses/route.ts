import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// The Responses tab on a profile: posts that reply to another post. Keyed on
// rootPostId (set for every response) so responses still list after their
// parent has been deleted.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  // Guests can browse public profiles; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const viewerId = session?.user?.id ?? "";

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;
  const { userId } = await ctx.params;

  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(viewerId),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    where: { rootPostId: { not: null }, userId },
  });

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
