import {
  getCommunityBySlug,
  getMembership,
  isCommunityModerator,
  prisma,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-members-api" });

// Community members. Pending requests are only visible to the owner/moderators;
// everyone else sees the active member list.
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const url = new URL(request.url);
  const includePending = url.searchParams.get("pending") === "1";

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }

    const canModerate = userId
      ? await isCommunityModerator(community.id, userId)
      : false;
    const wantsPending = includePending && canModerate;

    const members = await prisma.communityMember.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        createdAt: true,
        role: true,
        status: true,
        user: {
          select: {
            avatarUrl: true,
            displayName: true,
            id: true,
            username: true,
          },
        },
      },
      where: {
        communityId: community.id,
        status: wantsPending ? "PENDING" : "ACTIVE",
      },
    });

    const membership = userId
      ? await getMembership(community.id, userId)
      : null;

    return Response.json({ canModerate, members, membership });
  } catch (error) {
    logger.error({ error: String(error), slug }, "community members failed");
    return Response.json({ error: "Couldn't load members" }, { status: 500 });
  }
}
