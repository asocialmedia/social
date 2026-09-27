import { and, communityVisibilityWhere, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 24;
  const { userId } = await ctx.params;

  let query = prisma.orm.public.PostMedia.include("post", (post) =>
    post
      .select("explicitContent", "id", "isGust", "moderated")
      .include("community", (community) => community.select("slug"))
  )
    .where((media) =>
      and(
        media.post.some((post) =>
          and(
            post.userId.eq(userId),
            communityVisibilityWhere(session.user.id)(post)
          )
        ),
        media._type.in(["IMAGE", "VIDEO", "AUDIO"])
      )
    )
    .orderBy([(media) => media.createdAt.desc(), (media) => media.id.desc()]);
  if (cursor) {
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor's createdAt is read back here
    // because the page cursor only carries a media id. The seek is exclusive,
    // so no .offset(1) hop is needed. A vanished anchor restarts from the top
    // rather than 500ing the scroll.
    const anchor = await prisma.orm.public.PostMedia.select("createdAt")
      .where({ id: cursor })
      .first();
    if (anchor) {
      query = query.cursor({ createdAt: anchor.createdAt, id: cursor });
    }
  }
  const media = await query.limit(pageSize + 1).all();

  // The cursor must be the last SERVED row: anchoring on the look-ahead row
  // would skip an item on every page.
  const nextCursor =
    media.length > pageSize ? (media[pageSize - 1]?.id ?? null) : null;

  return Response.json({
    media: media.slice(0, pageSize).map((item) => ({
      ...item,
      type: item._type,
    })),
    nextCursor,
  });
}
