import {
  getPersonalizedFeedPage,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

const TAKE_PATTERN = /^[1-9]\d*$/;

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const initialId = url.searchParams.get("initialId") || undefined;
  const mode = url.searchParams.get("mode") === "personalized";
  // Explore's trending-gusts rail opts out of moderated gusts; the reels feed
  // keeps showing them.
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
      : 0;
  const pageSize = requestedTake > 0 ? Math.min(requestedTake, 20) : 10;

  // Personalized Gusts use the same user persona as fleet recommendations,
  // but the candidate set is constrained to video Gusts. Deep links with an
  // initial id stay chronological so the requested Gust remains first.
  if (mode && userId && !initialId && (!cursor || cursor.startsWith("fyp."))) {
    const personalized = await getPersonalizedFeedPage({
      contentKind: "gust",
      cursor,
      excludeModerated,
      includeVisited: true,
      pageSize,
      userId,
    });
    if (personalized.posts.length > 0) {
      const data: PostsPage = {
        nextCursor: personalized.nextCursor ?? personalized.anchorCursor,
        posts: await hydrateViewCounts(personalized.posts),
      };
      return Response.json(data, {
        headers: {
          "cache-control": "private, no-cache",
          vary: "Cookie",
        },
      });
    }
  }

  // When initialId is requested on the first page, ensure that gust is returned at the top
  if (initialId && !cursor) {
    const initialPost = await prisma.post.findUnique({
      include: getPostDataInclude(userId),
      where: {
        attachments: { some: { type: "VIDEO" } },
        id: initialId,
        isGust: true,
        // When the caller opted out of moderated gusts (explore rail), the
        // initial post is held to the same contract: a moderated gust is not
        // prepended.
        ...(excludeModerated ? { moderated: false } : {}),
      },
    });

    const otherPosts = await prisma.post.findMany({
      include: getPostDataInclude(userId),
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      where: {
        attachments: { some: { type: "VIDEO" } },
        id: { not: initialId },
        isGust: true,
        ...(excludeModerated ? { moderated: false } : {}),
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

  const where: Prisma.PostWhereInput = excludeModerated
    ? {
        attachments: { some: { type: "VIDEO" } },
        isGust: true,
        moderated: false,
      }
    : { attachments: { some: { type: "VIDEO" } }, isGust: true };
  const chronologicalCursor = cursor?.startsWith("exp.")
    ? cursor.slice(4) || undefined
    : cursor;

  const posts = await prisma.post.findMany({
    cursor: chronologicalCursor ? { id: chronologicalCursor } : undefined,
    include: getPostDataInclude(userId),
    orderBy: { createdAt: "desc" },
    skip: chronologicalCursor ? 1 : 0,
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
