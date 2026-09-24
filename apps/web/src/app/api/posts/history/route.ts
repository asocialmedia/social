import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostData } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const visits = await prisma.orm.public.PostVisits.select("postId")
    .where({ userId })
    .orderBy((visit) => visit.visitedAt.desc())
    .limit(12)
    .all();

  const postIds = visits.map((visit) => visit.postId);

  if (postIds.length === 0) {
    return Response.json({ posts: [] });
  }

  const postRows = await getPostDataQuery(prisma.orm, userId)
    .where((post) => and(post.id.in(postIds), post.moderated.eq(false)))
    .all();
  const posts = postRows.map(mapPostData);

  // Preserve the visited order (most recently visited first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = postIds
    .map((postId) => postById.get(postId))
    .filter((post): post is PostData => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);

  return Response.json({ posts: hydrated });
}
