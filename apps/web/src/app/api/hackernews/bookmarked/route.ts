import { hackerNewsAPI } from "@asm/aggregator/hackernews";
import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bookmarks = await prisma.hNBookmark.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const stories = (
    await Promise.all(
      bookmarks.map((bookmark) =>
        hackerNewsAPI.fetchStory(bookmark.storyId).catch(() => null)
      )
    )
  ).filter((story) => story !== null);

  return Response.json({ nextCursor: null, stories });
}

export const runtime = "nodejs";
