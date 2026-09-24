import {
  consumeRateLimit,
  getClientIpFromRequest,
  hashViewerId,
  postViewsCache,
  prisma,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// Batched view increment: the client accumulates visible post ids and posts
// them here in one request instead of one request per post. Views deduplicate
// per viewer (15 minutes). Self-views by authors return current counts without
// inflating metrics or milestone aura.
export async function POST(request: Request) {
  try {
    const session = await getSessionFromApi();
    const userId = session?.user?.id;
    const clientIp = getClientIpFromRequest(request);

    // Apply smart rate limiting to prevent high-frequency scraping or bot loops.
    // 60 requests/min is generous for continuous scrolling, while preventing automated flooding.
    const rateLimit = await consumeRateLimit({
      bucket: "views-batch",
      identifier: userId || clientIp || "unknown",
      limit: 60,
      windowSeconds: 60,
    });

    if (!rateLimit.allowed) {
      return Response.json(
        { error: "Too many view requests. Please slow down." },
        {
          headers: {
            "retry-after": String(rateLimit.retryAfterSeconds),
          },
          status: 429,
        }
      );
    }

    const body = (await request.json()) as { postIds?: unknown };
    const postIds = Array.isArray(body.postIds)
      ? body.postIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, 100)
      : [];

    const viewerHash = userId ? undefined : hashViewerId(clientIp);

    const persistedPosts = postIds.length
      ? await prisma.orm.public.Posts.select("id", "userId", "viewCount")
          .where((post) => post.id.in(postIds))
          .all()
      : [];
    const persistedById = new Map(
      persistedPosts.map((post) => [post.id, post.viewCount])
    );
    const authorById = new Map(
      persistedPosts.map((post) => [post.id, post.userId])
    );

    const entries = await Promise.all(
      postIds.map(async (postId) => {
        // Author self-views do not increment counts or contribute to view milestone aura
        const isSelfView = Boolean(userId && authorById.get(postId) === userId);
        if (isSelfView) {
          return [postId, 0] as const;
        }
        return [
          postId,
          await postViewsCache.incrementView(postId, {
            userId: userId || undefined,
            viewerHash,
          }),
        ] as const;
      })
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
