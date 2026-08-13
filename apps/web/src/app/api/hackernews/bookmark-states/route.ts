import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

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

  const bookmarks = await prisma.hNBookmark.findMany({
    where: {
      userId: user.id,
      storyId: { in: storyIds },
    },
    select: { storyId: true },
  });

  const bookmarked: Record<number, boolean> = {};
  for (const bookmark of bookmarks) {
    bookmarked[bookmark.storyId] = true;
  }

  return Response.json({ bookmarked });
}
