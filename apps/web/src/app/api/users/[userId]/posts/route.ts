import {
  getPostDataInclude,
  hydrateViewCounts,
  MediaType,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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
  const filter = url.searchParams.get("filter");
  const pageSize = 20;
  const { userId } = await ctx.params;

  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(user.id),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    where: {
      userId,
      ...(filter === "media"
        ? {
            attachments: {
              some: {
                type: {
                  in: [MediaType.IMAGE, MediaType.VIDEO, MediaType.AUDIO],
                },
              },
            },
          }
        : {}),
    },
  });

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  return Response.json(data);
}
