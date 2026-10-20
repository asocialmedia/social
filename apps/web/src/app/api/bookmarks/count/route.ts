import type { BookmarkCountInfo } from "@asm/db";
import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [userBookmarks, hnBookmarks, externalBookmarks] = await Promise.all([
    prisma.orm.public.Bookmarks.where({ userId })
      .select("id")
      .include("post", (post) => post.select("isGust"))
      .all()
      .then(
        (items) => items,
        () => []
      ),
    prisma.orm.public.HNBookmark.where({ userId })
      .aggregate((aggregate) => ({ count: aggregate.count() }))
      .then((result) => result.count)
      .catch(() => 0),
    prisma.orm.public.ExternalEngagements.where({
      bookmarked: true,
      userId,
    })
      .aggregate((aggregate) => ({ count: aggregate.count() }))
      .then((result) => result.count)
      .catch(() => 0),
  ]);

  let postBookmarks = 0;
  let gustBookmarks = 0;
  for (const b of userBookmarks) {
    if (b.post?.isGust) {
      gustBookmarks += 1;
    } else {
      postBookmarks += 1;
    }
  }

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
