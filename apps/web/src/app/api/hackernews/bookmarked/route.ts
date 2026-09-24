import { hackerNewsAPI } from "@asm/aggregator/hackernews";
import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bookmarks = await prisma.orm.public.HNBookmark.select("storyId")
    .where({ userId: user.id })
    .orderBy((bookmark) => bookmark.createdAt.desc())
    .all();

  const fetchedStories = await Promise.all(
    bookmarks.map((bookmark) =>
      hackerNewsAPI.fetchStory(bookmark.storyId).catch(() => null)
    )
  );
  const stories = fetchedStories.filter((story) => story !== null);

  return Response.json({ nextCursor: null, stories });
}
