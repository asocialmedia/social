import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

const TAKE_PATTERN = /^[1-9]\d*$/;

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const initialId = url.searchParams.get("initialId") || undefined;
  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
      : 0;
  const pageSize = requestedTake > 0 ? Math.min(requestedTake, 20) : 10;

  // When initialId is requested on the first page, ensure that gust is returned at the top
  if (initialId && !cursor) {
    const initialPost = await prisma.post.findUnique({
      include: getPostDataInclude(userId),
      where: { id: initialId, isGust: true },
    });

    const otherPosts = await prisma.post.findMany({
      include: getPostDataInclude(userId),
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      where: {
        id: { not: initialId },
        isGust: true,
      },
    });

    const combined = initialPost ? [initialPost, ...otherPosts] : otherPosts;
    const hydrated = await hydrateViewCounts(combined.slice(0, pageSize));
    const nextCursor =
      combined.length > pageSize ? combined[pageSize].id : null;

    const data: PostsPage = {
      nextCursor,
      posts: hydrated,
    };
    const responseHeaders = userId
      ? { "cache-control": "private, no-cache", vary: "Cookie" }
      : {
          "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
          vary: "Cookie",
        };

    return Response.json(data, { headers: responseHeaders });
  }

  const where: Prisma.PostWhereInput = {
    isGust: true,
  };

  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(userId),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    where,
  });

  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
  };
  const responseHeaders = userId
    ? { "cache-control": "private, no-cache", vary: "Cookie" }
    : {
        "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
        vary: "Cookie",
      };

  return Response.json(data, { headers: responseHeaders });
}
