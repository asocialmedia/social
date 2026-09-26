import {
  canViewCommunity,
  getCommunityBySlug,
  getMembership,
  invalidateCommunityPopulationAggregates,
  invalidateCommunityStats,
  isCommunityModerator,
  isSubscribedToCommunity,
  joinCommunity as joinCommunityService,
  leaveCommunity as leaveCommunityService,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import {
  communityErrorResponse,
  requireApiUser,
} from "@/communities/api-response";

const logger = createLogger({ serviceName: "community-membership-api" });

interface Params {
  params: Promise<{ slug: string }>;
}

// The single source of truth for everything the membership chrome needs: the
// JoinButton, the NotifyButton and the roster's moderation affordances all read
// this one payload, so a join cannot leave the bell or the role out of sync.
async function buildMembershipState(
  communityId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const [membership, subscribed, canModerate] = await Promise.all([
    getMembership(communityId, userId),
    isSubscribedToCommunity(communityId, userId),
    isCommunityModerator(communityId, userId),
  ]);
  return {
    canModerate,
    membership: membership
      ? { role: membership.role, status: membership.status }
      : null,
    subscribed,
  };
}

export async function GET(request: Request, { params }: Params) {
  const { slug } = await params;
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    // A private community's roster state is its contents, so an outsider gets
    // the same 404 the detail and feed routes give rather than a 403 that
    // confirms the community exists.
    if (!(await canViewCommunity(community, user.userId))) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    return Response.json(await buildMembershipState(community.id, user.userId));
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "membership.read",
      slug,
      userId: user.userId,
    });
  }
}

export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    const result = await joinCommunityService(community.id, user.userId);
    // Only an ACTIVE join moves the roster. A PENDING request leaves the member
    // count and the discovery member total untouched, so invalidating them here
    // would flash a count the user has not actually changed.
    if (result.status === "ACTIVE") {
      await Promise.all([
        invalidateCommunityStats(community.id),
        invalidateCommunityPopulationAggregates(),
      ]);
    }
    logger.info(
      { communityId: community.id, status: result.status, userId: user.userId },
      "community joined via api"
    );
    return Response.json(
      {
        status: result.status,
        ...(await buildMembershipState(community.id, user.userId)),
      },
      { status: 201 }
    );
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "membership.join",
      slug,
      userId: user.userId,
    });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { slug } = await params;
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    await leaveCommunityService(community.id, user.userId);
    await Promise.all([
      invalidateCommunityStats(community.id),
      invalidateCommunityPopulationAggregates(),
    ]);
    logger.info(
      { communityId: community.id, userId: user.userId },
      "community left via api"
    );
    return Response.json(await buildMembershipState(community.id, user.userId));
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "membership.leave",
      slug,
      userId: user.userId,
    });
  }
}
