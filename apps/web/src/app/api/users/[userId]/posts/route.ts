import {
  getPostDataInclude,
  hydrateViewCounts,
  MediaType,
  prisma,
} from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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

  let where: Prisma.PostWhereInput;
  if (filter === "gusts") {
    where = { isGust: true, userId };
  } else if (filter === "media") {
    where = {
      attachments: {
        some: {
          type: {
            in: [MediaType.IMAGE, MediaType.VIDEO, MediaType.AUDIO],
          },
        },
      },
      userId,
    };
  } else {
    where = { isGust: false, userId };
  }

  if (excludeModerated) {
    where = { ...where, moderated: false };
  }

  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(viewerId),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    where,
  });

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
