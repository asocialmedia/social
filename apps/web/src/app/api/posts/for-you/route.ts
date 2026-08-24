import {
  getPersonalizedFeedPage,
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { PostsPage, Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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

  // Personalization only shapes the first page: signed-in users with no
  // cursor get the ranked pool. The personalized page's anchor cursor hands
  // control back to strict recency below; it points at the oldest candidate
  // pool post, so page 2 resumes gap-free right where the pool ended.
  let data: PostsPage | null = null;
  if (userId && !cursor) {
    const personalized = await getPersonalizedFeedPage({
      excludeModerated,
      pageSize,
      userId,
    });
    if (personalized.posts.length > 0) {
      data = {
        nextCursor: personalized.anchorCursor,
        posts: await hydrateViewCounts(personalized.posts),
      };
    }
  }

  if (!data) {
    // Guests, cursor pages, and cold-start fallbacks all use plain recency.
    const where: Prisma.PostWhereInput = excludeModerated
      ? { isGust: false, moderated: false }
      : { isGust: false };

    let posts;
    try {
      posts = await prisma.post.findMany({
        cursor: cursor ? { id: cursor } : undefined,
        include: getPostDataInclude(userId),
        orderBy: { createdAt: "desc" },
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
        orderBy: { createdAt: "desc" },
        take: pageSize + 1,
        where,
      });
    }

    const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
    data = {
      nextCursor: posts.length > pageSize ? posts[pageSize].id : null,
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
