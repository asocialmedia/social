import {
  and,
  communityVisibilityWhere,
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
  // Guests can browse public profiles; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const viewerId = session?.user?.id ?? "";

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const filter = url.searchParams.get("filter");
  // Sidebar "more from" cards opt out of moderated posts via this param; the
  // profile feed itself still shows them (with the notice) since moderation
  // state is intentionally never hidden from full post surfaces.
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  const pageSize = 20;
  const { userId } = await ctx.params;

  let query = getPostDataQuery(prisma.orm, viewerId)
    .where((post) => {
      const filters = [
        post.userId.eq(userId),
        communityVisibilityWhere(viewerId)(post),
      ];
      if (filter === "gusts") {
        filters.push(post.isGust.eq(true));
      } else {
        filters.push(post.isGust.eq(false));
      }
      if (filter === "media") {
        filters.push(
          post.postMedias.some((media) =>
            media._type.in(["IMAGE", "VIDEO", "AUDIO"])
          )
        );
      }
      if (excludeModerated) {
        filters.push(post.moderated.eq(false));
      }
      return and(...filters);
    })
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
