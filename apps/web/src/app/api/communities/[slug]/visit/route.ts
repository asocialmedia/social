import {
  canViewCommunity,
  getCommunityBySlug,
  recordCommunityVisit,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-visit-api" });

// Records a community page view for the signed-in viewer. One row per
// (community, viewer), refreshed on each visit; the weekly visitor count reads
// this rolling window. Guests are a no-op (no guest identity exists).
export async function POST(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ recorded: false });
  }

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    // Never record a visit to a PRIVATE community the viewer cannot read; a
    // member's trail must not be seeded by a denied lookup either.
    if (!(await canViewCommunity(community, userId))) {
      return Response.json({ recorded: false });
    }
    await recordCommunityVisit(community.id, userId);
    return Response.json({ recorded: true });
  } catch (error) {
    logger.error({ error: String(error), slug }, "community visit failed");
    return Response.json({ recorded: false });
  }
}
