import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET(request: Request) {
  // Guests can browse the public feed; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  // Explore opts out of moderated posts so its compact cards never show a
  // moderation row; the home feed still returns them.
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  const pageSize = 20;

  const where: Prisma.PostWhereInput = excludeModerated
    ? { isGust: false, moderated: false }
    : { isGust: false };

  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(userId),
    orderBy: [{ aura: "desc" }, { id: "desc" }],
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
        "cache-control": "public, s-maxage=15, stale-while-revalidate=45",
        vary: "Cookie",
      };

  return Response.json(data, { headers: responseHeaders });
}
