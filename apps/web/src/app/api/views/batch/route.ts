import { postViewsCache, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

// Batched view increment: the client accumulates visible post ids and posts
// them here in one request instead of one request per post. Dedup is still
// enforced server-side per (user, post).
//
// incrementView returns the Redis counter, which only holds the delta since
// the last worker flush (often just 1). The client patches its caches with
// these results, so returning the raw delta made every viewed post display a
// tiny count ("1") until a hard refresh. Persisted counts are read before the
// increments so the total (persisted + delta) is accurate even if the flush
// worker runs mid-request.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { postIds?: unknown };
    const postIds = Array.isArray(body.postIds)
      ? body.postIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, 100)
      : [];

    const session = await getSessionFromApi();
    const userId = session?.user?.id;

    const persistedPosts = postIds.length
      ? await prisma.post.findMany({
          select: { id: true, viewCount: true },
          where: { id: { in: postIds } },
        })
      : [];
    const persistedById = new Map(
      persistedPosts.map((post) => [post.id, post.viewCount])
    );

    const entries = await Promise.all(
      postIds.map(
        async (postId) =>
          [
            postId,
            await postViewsCache.incrementView(postId, {
              userId: userId || undefined,
            }),
          ] as const
      )
    );

    const results: Record<string, number> = {};
    for (const [postId, delta] of entries) {
      results[postId] = (persistedById.get(postId) ?? 0) + delta;
    }

    return Response.json({ results, success: true });
  } catch (error) {
    console.error("Failed to batch increment views:", error);
    return Response.json(
      { error: "Failed to increment views" },
      { status: 500 }
    );
  }
}
