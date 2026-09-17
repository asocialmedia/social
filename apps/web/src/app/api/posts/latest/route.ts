import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

const TAKE_PATTERN = /^[1-9]\d*$/;
const PAGE_SIZE = 20;

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
      : 0;
  const pageSize =
    requestedTake > 0 ? Math.min(requestedTake, PAGE_SIZE) : PAGE_SIZE;

  // Native community posts live in their community feed, not Latest; reshares
  // onto the global feed have communityId null and still appear here.
  const where: Prisma.PostWhereInput = excludeModerated
    ? { communityId: null, isGust: false, moderated: false }
    : { communityId: null, isGust: false };
  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: cursor ? 1 : 0,
    take: pageSize + 1,
    where,
  });

  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor:
      posts.length > pageSize ? (posts[pageSize - 1]?.id ?? null) : null,
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
