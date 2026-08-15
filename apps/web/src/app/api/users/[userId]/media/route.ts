import { MediaType, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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

  const media = await prisma.media.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: {
      // Lets the gallery route gust media to /gusts instead of /posts.
      post: { select: { isGust: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    where: {
      post: { userId },
      type: {
        in: [
          MediaType.IMAGE,
          MediaType.VIDEO,
          MediaType.AUDIO,
          MediaType.CODE,
          MediaType.DOCUMENT,
        ],
      },
    },
  });

  const nextCursor = media.length > pageSize ? media[pageSize].id : null;

  return Response.json({
    media: media.slice(0, pageSize),
    nextCursor,
  });
}
