import {
  getCommunityBySlug,
  getCommunityFeedPage,
  hydrateViewCounts,
} from "@asm/db";
import type { PostsPage } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-feed-api" });

// The community's own feed. "new" (default) is chronological, "top" ranks by
// post aura. Native posts only; reshares live on the global feed.
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const sort = url.searchParams.get("sort") === "top" ? "top" : "new";

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }

    const page = await getCommunityFeedPage({
      communityId: community.id,
      cursor,
      loggedInUserId: userId,
      sort,
    });

    const data: PostsPage = {
      nextCursor: page.nextCursor,
      posts: await hydrateViewCounts(page.posts),
    };

    const headers = userId
      ? { "cache-control": "private, no-cache", vary: "Cookie" }
      : {
          "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
          vary: "Cookie",
        };
    return Response.json(data, { headers });
  } catch (error) {
    logger.error({ error: String(error), slug }, "community feed failed");
    return Response.json({ error: "Couldn't load the feed" }, { status: 500 });
  }
}
