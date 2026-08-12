import { getPostDataInclude, MediaType, type PostsPage, prisma } from "@asm/db";
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
    orderBy: { createdAt: "desc" },
    include: getPostDataInclude(user.id),
    take: pageSize + 1,
    cursor: cursor ? { id: cursor } : undefined,
  });

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const data: PostsPage = {
    posts: posts.slice(0, pageSize),
    nextCursor,
  };
  return Response.json(data);
}
