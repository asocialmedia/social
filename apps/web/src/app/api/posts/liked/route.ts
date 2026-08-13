import {
  getPostDataInclude,
  hydrateViewCounts,
  type PostsPage,
  prisma,
} from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const votes = await prisma.vote.findMany({
    where: { userId: user.id, value: 1 },
    orderBy: { createdAt: "desc" },
    select: { postId: true },
  });

  const postIds = votes.map((vote) => vote.postId);

  if (postIds.length === 0) {
    return Response.json({ nextCursor: null, posts: [] });
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    include: getPostDataInclude(user.id),
  });

  // Preserve the vote order (most recently liked first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = postIds
    .map((postId) => postById.get(postId))
    .filter((post) => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);
  const data: PostsPage = {
    posts: hydrated,
    nextCursor: null,
  };
  return Response.json(data);
}
