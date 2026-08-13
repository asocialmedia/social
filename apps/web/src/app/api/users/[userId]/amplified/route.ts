import {
  getPostDataInclude,
  hydrateViewCounts,
  type PostsPage,
  prisma,
} from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;
  const { userId } = await ctx.params;

  const votes = await prisma.vote.findMany({
    where: { userId, value: 1 },
    orderBy: [{ createdAt: "desc" }, { postId: "desc" }],
    select: { postId: true, createdAt: true },
    take: pageSize + 1,
    ...(cursor
      ? {
          cursor: {
            userId_postId: {
              userId,
              postId: cursor,
            },
          },
          skip: 1,
        }
      : {}),
  });

  const hasMore = votes.length > pageSize;
  const pageVotes = votes.slice(0, pageSize);
  const nextCursor: string | null = hasMore
    ? (pageVotes.at(-1)?.postId ?? null)
    : null;

  if (pageVotes.length === 0) {
    return Response.json({ nextCursor, posts: [] });
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: pageVotes.map((vote) => vote.postId) } },
    include: getPostDataInclude(user.id),
  });

  // Preserve the vote order (most recently amplified first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = pageVotes
    .map((vote) => postById.get(vote.postId))
    .filter((post) => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);
  const data: PostsPage = {
    posts: hydrated,
    nextCursor,
  };
  return Response.json(data);
}
