import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;

  let query = getPostDataQuery(prisma.orm, userId)
    .where((post) =>
      and(
        post.userId.neq(userId),
        post.isGust.eq(false),
        post.user.some((user) =>
          user.followsFollows.some((follow) => follow.followerId.eq(userId))
        )
      )
    )
    .orderBy((post) => post.createdAt.desc());
  if (cursor) {
    query = query.cursor({ id: cursor }).offset(1);
  }
  const postRows = await query.limit(pageSize + 1).all();
  const posts = postRows.map(mapPostData);

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
