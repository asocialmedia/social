import type { BookmarkCountInfo } from "@asm/db";
import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [postBookmarks, gustBookmarks, hnBookmarks] = await Promise.all([
    prisma.bookmark.count({ where: { post: { isGust: false }, userId } }),
    prisma.bookmark.count({ where: { post: { isGust: true }, userId } }),
    prisma.hNBookmark.count({ where: { userId } }),
  ]);

  return Response.json({
    // Matches the sidebar's historical total: posts + HN (gusts are tracked
    // separately on the bookmarks page).
    gustCount: gustBookmarks,
    hnCount: hnBookmarks,
    postCount: postBookmarks,
    totalCount: postBookmarks + hnBookmarks,
  } satisfies BookmarkCountInfo);
}
