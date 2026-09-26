import {
  getCommunityBySlug,
  invalidateCommunityStats,
  isSubscribedToCommunity,
  subscribeToCommunity as subscribeToCommunityService,
  unsubscribeFromCommunity as unsubscribeFromCommunityService,
} from "@asm/db";

import {
  communityErrorResponse,
  requireApiUser,
} from "@/communities/api-response";

interface Params {
  params: Promise<{ slug: string }>;
}

// Opting into a community's posts. Independent of membership: a public
// community can be followed without joining, and the service is what enforces
// that a private community is members-only.
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
    await subscribeToCommunityService(community.id, user.userId);
    return Response.json({
      subscribed: await isSubscribedToCommunity(community.id, user.userId),
    });
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "subscription.subscribe",
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
    await unsubscribeFromCommunityService(community.id, user.userId);
    // The Latest feed interleaves a community's posts by subscription, so the
    // community's own aggregate is refreshed alongside the row.
    await invalidateCommunityStats(community.id);
    return Response.json({ subscribed: false });
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "subscription.unsubscribe",
      slug,
      userId: user.userId,
    });
  }
}
