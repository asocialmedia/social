import {
  getCachedCommunityStats,
  getCommunityBySlug,
  getMembership,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-detail-api" });

// Community detail: identity + aggregated stats + the viewer's membership.
// Viewing is public; the membership block is empty for guests.
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }

    const [stats, membership] = await Promise.all([
      getCachedCommunityStats(community.id),
      userId ? getMembership(community.id, userId) : Promise.resolve(null),
    ]);

    return Response.json({ community, membership, stats });
  } catch (error) {
    logger.error({ error: String(error), slug }, "community detail failed");
    return Response.json(
      { error: "Couldn't load that community" },
      { status: 500 }
    );
  }
}
