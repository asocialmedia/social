import { postViewsCache } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

// Batched view increment: the client accumulates visible post ids and posts
// them here in one request instead of one request per post. Dedup is still
// enforced server-side per (user, post).
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

    const entries = await Promise.all(
      postIds.map(
        async (postId) =>
          [postId, await postViewsCache.incrementView(postId, userId)] as const
      )
    );

    const results: Record<string, number> = Object.fromEntries(entries);

    return Response.json({ results, success: true });
  } catch (error) {
    console.error("Failed to batch increment views:", error);
    return Response.json(
      { error: "Failed to increment views" },
      { status: 500 }
    );
  }
}
