import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    storyIds?: number[];
  } | null;

  const storyIds = Array.isArray(body?.storyIds)
    ? body.storyIds.filter(Number.isInteger).slice(0, 200)
    : [];

  if (storyIds.length === 0) {
    return Response.json({ bookmarked: {} });
  }

  const bookmarks = await prisma.orm.public.HNBookmark.select("storyId")
    .where((bookmark) =>
      and(bookmark.storyId.in(storyIds), bookmark.userId.eq(user.id))
    )
    .all();

  const bookmarked: Record<number, boolean> = {};
  for (const bookmark of bookmarks) {
    bookmarked[bookmark.storyId] = true;
  }

  return Response.json({ bookmarked });
}
