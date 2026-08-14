import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const votes = await prisma.vote.findMany({
    orderBy: { createdAt: "desc" },
    select: { postId: true },
    where: { userId: user.id, value: 1 },
  });

  const postIds = votes.map((vote) => vote.postId);

  if (postIds.length === 0) {
    return Response.json({ nextCursor: null, posts: [] });
  }

  const posts = await prisma.post.findMany({
    include: getPostDataInclude(user.id),
    where: { id: { in: postIds } },
  });

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
