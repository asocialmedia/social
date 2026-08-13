import {
  getPostDataInclude,
  hydrateViewCounts,
  type PostsPage,
  prisma,
} from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;

  const posts = await prisma.post.findMany({
    include: getPostDataInclude(userId),
    orderBy: [{ aura: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    cursor: cursor ? { id: cursor } : undefined,
  });

  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const data: PostsPage = {
    posts: hydrated,
    nextCursor,
  };
  return Response.json(data);
}
