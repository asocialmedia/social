import {
  communityVisibilityWhere,
  getPersonalizedFeedPage,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// A valid take value is a positive integer only (no partial-prefix parsing).
const TAKE_PATTERN = /^[1-9]\d*$/;

// Prisma rejects cursors whose row no longer exists (P2025). A feed cursor can
// outlive its post — deleted between pages, or moderated away — and a stale
// anchor must degrade to a fresh page instead of 500ing the scroll.
function isMissingCursorError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export async function GET(request: Request) {
  // Guests can browse the public feed; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  // "Related / more from" surfaces opt out of moderated posts so their compact
  // cards never show a moderation row; the main feed still returns them.
  const excludeModerated = url.searchParams.get("excludeModerated") === "1";
  // Validate the whole take value, accept only a positive integer, cap at 20,
  // default malformed to 20.
  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
      : 0;
  const pageSize = requestedTake > 0 ? Math.min(requestedTake, 20) : 20;

  // Personalization serves ranked candidate slices for signed-in users.
  // When cursor is undefined or begins with "fyp.", we serve from the ranked pool.
  // Once the ranked pool is exhausted, the cursor transitions to "exp." or post ID,
  // continuing to stream older/expired posts at the bottom so NO posts are hidden.
  let data: PostsPage | null = null;
  if (userId && (!cursor || cursor.startsWith("fyp."))) {
    const personalized = await getPersonalizedFeedPage({
      cursor,
      excludeModerated,
      includeVisited: true,
      pageSize,
      userId,
    });
    if (personalized.posts.length > 0) {
      let { posts } = personalized;
      let nextCursor = personalized.nextCursor ?? personalized.anchorCursor;

      // If the ranked pool is smaller than a full page, continue directly
      // into the chronological archive so Explore and Home do not render a
      // sparse page when older eligible posts still exist.
      if (
        posts.length < pageSize &&
        personalized.nextCursor?.startsWith("exp.")
      ) {
        const chronologicalCursor =
          personalized.nextCursor.slice(4) || undefined;
        const fallbackWhere: Prisma.PostWhereInput = {
          isGust: false,
          moderated: excludeModerated ? false : undefined,
          userId: { not: userId },
          ...communityVisibilityWhere(userId),
        };
        const fallbackPosts = await prisma.post.findMany({
          cursor: chronologicalCursor ? { id: chronologicalCursor } : undefined,
          include: getPostDataInclude(userId),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: chronologicalCursor ? 1 : 0,
          take: pageSize - posts.length + 1,
          where: fallbackWhere,
        });
        const seenPostIds = new Set(posts.map((post) => post.id));
        const fillPosts = fallbackPosts.filter(
          (post) => !seenPostIds.has(post.id)
        );
        posts = [...posts, ...fillPosts.slice(0, pageSize - posts.length)];
        nextCursor =
          fillPosts.length > pageSize - personalized.posts.length
            ? (fillPosts[pageSize - personalized.posts.length - 1]?.id ?? null)
            : null;
      }

      data = {
        nextCursor,
        posts: await hydrateViewCounts(posts),
      };
    }
  }

  if (!data) {
    // Guests, cursor pages beyond the candidate pool, and cold-start fallbacks
    // stream all remaining/expired posts chronologically at the bottom.
    const where: Prisma.PostWhereInput = {
      isGust: false,
      moderated: excludeModerated ? false : undefined,
      userId: userId ? { not: userId } : undefined,
      // Private-community posts never stream into a global feed.
      ...communityVisibilityWhere(userId),
    };

    const rawCursor =
      cursor && cursor.startsWith("exp.")
        ? cursor.slice(4) || undefined
        : cursor;

    let posts;
    try {
      posts = await prisma.post.findMany({
        cursor: rawCursor ? { id: rawCursor } : undefined,
        include: getPostDataInclude(userId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: rawCursor ? 1 : 0,
        take: pageSize + 1,
        where,
      });
    } catch (error) {
      if (!isMissingCursorError(error)) {
        throw error;
      }
      // The anchor post vanished mid-scroll; restart the feed from the top
      // rather than failing the request.
      posts = await prisma.post.findMany({
        include: getPostDataInclude(userId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize + 1,
        where,
      });
    }

    const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
    data = {
      nextCursor: posts.length > pageSize ? posts[pageSize - 1].id : null,
      posts: hydrated,
    };
  }

  const responseHeaders = userId
    ? { "cache-control": "private, no-cache", vary: "Cookie" }
    : {
        "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
        vary: "Cookie",
      };

  return Response.json(data, { headers: responseHeaders });
}
