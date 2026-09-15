import {
  getCachedCommunityStats,
  getJoinedCommunities,
  listCommunities,
  searchCommunities,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-api" });

// Discovery listing + search. Public for everyone; when a session exists the
// response also carries the viewer's joined communities so the discovery page
// can render "Your communities" without a second round trip.
export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const topic = url.searchParams.get("topic")?.trim() || undefined;
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const joinedOnly = url.searchParams.get("joined") === "1";
  const limitParam = Number(url.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(limitParam) ? limitParam : 24;

  try {
    // The sidebar rail only needs the viewer's joined communities; skip the
    // listing and the stats aggregation entirely for that call.
    if (joinedOnly) {
      const joined = userId ? await getJoinedCommunities(userId) : [];
      return Response.json({
        communities: [],
        joined,
        nextCursor: null,
        stats: {},
      });
    }

    const [page, joined, results] = await Promise.all([
      q
        ? Promise.resolve({ communities: [], nextCursor: null })
        : listCommunities({ cursor, limit, topic }),
      userId ? getJoinedCommunities(userId) : Promise.resolve([]),
      q ? searchCommunities(q, limit) : Promise.resolve([]),
    ]);

    // Stats are only fetched for the communities actually on screen, and the
    // cache keeps the discovery grid from hammering the aggregate queries.
    const communities = q ? results : page.communities;
    const stats = await Promise.all(
      communities.map(async (community) => ({
        communityId: community.id,
        stats: await getCachedCommunityStats(community.id),
      }))
    );

    return Response.json({
      communities,
      joined,
      nextCursor: q ? null : page.nextCursor,
      stats: Object.fromEntries(
        stats.map((entry) => [entry.communityId, entry.stats])
      ),
    });
  } catch (error) {
    logger.error({ error: String(error) }, "community list failed");
    return Response.json(
      { error: "Couldn't load communities" },
      { status: 500 }
    );
  }
}
