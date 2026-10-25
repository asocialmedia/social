import {
  and,
  communityVisibilityWhere,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  fromPrismaDateTime,
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
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor vote's createdAt is read back
    // here because the page cursor only carries a postId. The seek is
    // exclusive, so no .offset(1) hop is needed. A vanished anchor (vote
    // retracted mid-scroll) restarts from the top rather than 500ing the scroll.
    const anchor = await prisma.orm.public.Votes.select("createdAt")
      .where((vote) => and(vote.userId.eq(userId), vote.postId.eq(cursor)))
      .first();
    if (anchor) {
      voteQuery = voteQuery.cursor({
        createdAt: anchor.createdAt,
        postId: cursor,
      });
    }
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
    .where((post) =>
      and(
        post.id.in(pageVotes.map((vote) => vote.postId)),
        communityVisibilityWhere(user.id)(post),
        post.moderated.eq(false)
      )
    )
    .all();
  const posts = postRows.map(mapPostData);

  // Preserve the vote order (most recently amplified first).
  const postById = new Map(posts.map((post) => [post.id, post]));
  const orderedPosts = pageVotes
    .map((vote) => postById.get(vote.postId))
    .filter((post) => post !== undefined);

  const withViewCounts = await hydrateViewCounts(orderedPosts);
  const hydrated = withViewCounts.map((post) => ({
    ...post,
    amplifiedAt: fromPrismaDateTime(
      pageVotes.find((vote) => vote.postId === post.id)?.createdAt ??
        post.createdAt
    ).toISOString(),
  }));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
