import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostData } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const visits = await prisma.postVisit.findMany({
    orderBy: { visitedAt: "desc" },
    select: { postId: true },
    take: 12,
    where: { userId },
  });

  const postIds = visits.map((visit) => visit.postId);

  if (postIds.length === 0) {
    return Response.json({ posts: [] });
  }

  const posts = await prisma.post.findMany({
    include: getPostDataInclude(userId),
    // Moderated posts are excluded from the recents sidebar card at the API
    // level; their rows are removed entirely rather than shown with a notice.
    where: { id: { in: postIds }, moderated: false },
  });

  // Preserve the visited order (most recently visited first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = postIds
    .map((postId) => postById.get(postId))
    .filter((post): post is PostData => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);

  return Response.json({ posts: hydrated });
}
