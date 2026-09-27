import {
  and,
  getPostDataQuery,
  getSubscribedCommunityIds,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

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
  let query = getPostDataQuery(prisma.orm, userId)
    .where((post) => {
      const filters = [post.isGust.eq(false)];
      if (excludeModerated) {
        filters.push(post.moderated.eq(false));
      }
      if (subscribedCommunityIds.length > 0) {
        filters.push(
          post.communityId.isNull(),
          post.communityId.in(subscribedCommunityIds)
        );
      } else {
        filters.push(post.communityId.isNull());
      }
      return and(...filters);
    })
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()]);
  if (cursor) {
    // Prisma 8 cursors are keyset seeks built from the values passed in, so
    // every orderBy column needs one: the anchor's createdAt is read back here
    // because the feed cursor only carries a post id. The seek is exclusive, so
    // no .offset(1) hop is needed. A vanished anchor (deleted or moderated
    // mid-scroll) restarts from the top rather than 500ing the scroll.
    const anchor = await prisma.orm.public.Posts.select("createdAt")
      .where({ id: cursor })
      .first();
    if (anchor) {
      query = query.cursor({ createdAt: anchor.createdAt, id: cursor });
    }
  }
  const postRows = await query.limit(pageSize + 1).all();
  const posts = postRows.map(mapPostData);

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
