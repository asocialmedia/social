import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// The Responses tab on a profile: posts that reply to another post. Keyed on
// rootPostId (set for every response) so responses still list after their
// parent has been deleted.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  // Guests can browse public profiles; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const viewerId = session?.user?.id ?? "";

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;
  const { userId } = await ctx.params;

  let query = getPostDataQuery(prisma.orm, viewerId)
    .where((post) => and(post.rootPostId.isNotNull(), post.userId.eq(userId)))
    .orderBy((post) => post.createdAt.desc());
  if (cursor) {
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor's createdAt is read back here
    // because the page cursor only carries a post id. The seek is exclusive, so
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
