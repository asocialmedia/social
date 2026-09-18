import {
  getPostDataInclude,
  getSubscribedCommunityIds,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
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

  // Latest is the global timeline: global posts (communityId null, which
  // includes reshares) plus the posts of communities the viewer subscribes to,
  // interleaved by time. Native community posts never appear here unless the
  // viewer opted in, and the subscriber lookup already restricts to communities
  // the viewer may currently read.
  const subscribedCommunityIds = userId
    ? await getSubscribedCommunityIds(userId)
    : [];
  const where: Prisma.PostWhereInput = {
    isGust: false,
    ...(excludeModerated ? { moderated: false } : {}),
  };
  if (subscribedCommunityIds.length > 0) {
    where.OR = [
      { communityId: null },
      { communityId: { in: subscribedCommunityIds } },
    ];
  } else {
    // No subscriptions (a guest, or a viewer who follows none): the plain
    // global-posts constraint, so the common case stays one simple predicate.
    where.communityId = null;
  }
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
