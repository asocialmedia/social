import type { BookmarkCountInfo } from "@asm/db";
import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [postBookmarks, hnBookmarks] = await Promise.all([
    prisma.bookmark.count({ where: { userId } }),
    prisma.hNBookmark.count({ where: { userId } }),
  ]);

  return Response.json({
    totalCount: postBookmarks + hnBookmarks,
  } satisfies BookmarkCountInfo);
}
