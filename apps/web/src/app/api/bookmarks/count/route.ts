import type { BookmarkCountInfo } from "@asm/db";
import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [postBookmarks, gustBookmarks, hnBookmarks, externalBookmarks] =
    await Promise.all([
      prisma.orm.public.Bookmarks.where((bookmark) =>
        and(
          bookmark.post.some((post) => post.isGust.eq(false)),
          bookmark.userId.eq(userId)
        )
      )
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count),
      prisma.orm.public.Bookmarks.where((bookmark) =>
        and(
          bookmark.post.some((post) => post.isGust.eq(true)),
          bookmark.userId.eq(userId)
        )
      )
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count),
      prisma.orm.public.HNBookmark.where({ userId })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count),
      prisma.orm.public.ExternalEngagements.where({
        bookmarked: true,
        userId,
      })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .then((result) => result.count)
        .catch(() => 0),
    ]);

  const totalPostBookmarks = postBookmarks + externalBookmarks;

  return Response.json({
    // Matches the sidebar's historical total: posts/fleets + HN (gusts are tracked
    // separately on the bookmarks page).
    gustCount: gustBookmarks,
    hnCount: hnBookmarks,
    postCount: totalPostBookmarks,
    totalCount: totalPostBookmarks + hnBookmarks,
  } satisfies BookmarkCountInfo);
}
