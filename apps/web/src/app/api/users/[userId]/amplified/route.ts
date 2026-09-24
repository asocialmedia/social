import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

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

  let voteQuery = prisma.orm.public.Votes.select("createdAt", "postId")
    .where((vote) => and(vote.userId.eq(userId), vote.value.eq(1)))
    .orderBy([(vote) => vote.createdAt.desc(), (vote) => vote.postId.desc()]);
  if (cursor) {
    voteQuery = voteQuery.cursor({ postId: cursor }).offset(1);
  }
  const votes = await voteQuery.limit(pageSize + 1).all();

  const hasMore = votes.length > pageSize;
  const pageVotes = votes.slice(0, pageSize);
  const nextCursor: string | null = hasMore
    ? (pageVotes.at(-1)?.postId ?? null)
    : null;

  if (pageVotes.length === 0) {
    return Response.json({ nextCursor, posts: [] });
  }

  const postRows = await getPostDataQuery(prisma.orm, user.id)
    .where((post) => post.id.in(pageVotes.map((vote) => vote.postId)))
    .all();
  const posts = postRows.map(mapPostData);

  // Preserve the vote order (most recently amplified first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = pageVotes
    .map((vote) => postById.get(vote.postId))
    .filter((post) => post !== undefined);

  const hydrated = await hydrateViewCounts(orderedPosts);
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
