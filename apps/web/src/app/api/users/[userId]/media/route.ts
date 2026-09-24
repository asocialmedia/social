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
    query = query.cursor({ id: cursor }).offset(1);
  }
  const media = await query.limit(pageSize + 1).all();

  const nextCursor = media.length > pageSize ? media[pageSize].id : null;

  return Response.json({
    media: media.slice(0, pageSize).map((item) => ({
      ...item,
      type: item._type,
    })),
    nextCursor,
  });
}
