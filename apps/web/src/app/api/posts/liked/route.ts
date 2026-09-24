import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const votes = await prisma.orm.public.Votes.select("postId")
    .where((vote) => and(vote.userId.eq(user.id), vote.value.eq(1)))
    .orderBy((vote) => vote.createdAt.desc())
    .all();

  const postIds = votes.map((vote) => vote.postId);

  if (postIds.length === 0) {
    return Response.json({ nextCursor: null, posts: [] });
  }

  const postRows = await getPostDataQuery(prisma.orm, user.id)
    .where((post) => post.id.in(postIds))
    .all();
  const posts = postRows.map(mapPostData);

  // Preserve the vote order (most recently liked first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = postIds
    .map((postId) => postById.get(postId))
    .filter((post) => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);
  const data: PostsPage = {
    nextCursor: null,
    posts: hydrated,
  };
  return Response.json(data);
}
