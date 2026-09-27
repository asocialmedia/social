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
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor's createdAt is read back here
    // because the feed cursor only carries a post id. The seek is exclusive, so
    // no .offset(1) hop is needed. A vanished anchor restarts from the top
    // rather than 500ing the scroll.
    const anchor = await prisma.orm.public.Posts.select("createdAt")
      .where({ id: cursor })
      .first();
    if (anchor) {
      query = query.cursor({ createdAt: anchor.createdAt, id: cursor });
    }
  }
  const postRows = await query.limit(pageSize + 1).all();
  const posts = postRows.map(mapPostData);

  // The cursor must be the last SERVED row: anchoring on the look-ahead row
  // would skip a post on every page.
  const nextCursor =
    posts.length > pageSize ? (posts[pageSize - 1]?.id ?? null) : null;
  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
