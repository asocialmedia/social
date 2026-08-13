import {
  getPostDataInclude,
  hydrateViewCounts,
  type PostData,
  prisma,
} from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const visits = await prisma.postVisit.findMany({
    where: { userId },
    orderBy: { visitedAt: "desc" },
    take: 12,
    select: { postId: true },
  });

  const postIds = visits.map((visit) => visit.postId);

  if (postIds.length === 0) {
    return Response.json({ posts: [] });
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    include: getPostDataInclude(userId),
  });

  // Preserve the visited order (most recently visited first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = postIds
    .map((postId) => postById.get(postId))
    .filter((post): post is PostData => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);

  return Response.json({ posts: hydrated });
}
