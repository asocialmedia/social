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
