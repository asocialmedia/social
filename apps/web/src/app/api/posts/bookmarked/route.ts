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

  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: user.id },
    include: { post: true },
    orderBy: { createdAt: "desc" },
  });

  const postIds = bookmarks
    .map((bookmark) => bookmark.postId)
    .filter((postId): postId is string => Boolean(postId));

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    include: getPostDataInclude(user.id),
  });

  // Preserve the bookmark order (most recently bookmarked first).
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
