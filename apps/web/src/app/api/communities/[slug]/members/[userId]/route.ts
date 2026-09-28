import {
  approveMember as approveMemberService,
  getCommunityBySlug,
  getMembership,
  invalidateCommunityPopulationAggregates,
  invalidateCommunityStats,
  setMemberRole as setMemberRoleService,
} from "@asm/db";
import type { AssignableCommunityRole } from "@asm/db";
import { createLogger } from "@asm/logger";

import {
  communityErrorResponse,
  readJsonBody,
  requireApiUser,
} from "@/communities/api-response";

const logger = createLogger({ serviceName: "community-member-api" });

interface Params {
  params: Promise<{ slug: string; userId: string }>;
}

const ASSIGNABLE_ROLES = new Set<AssignableCommunityRole>([
  "MEMBER",
  "MODERATOR",
  "PARTICIPANT",
]);

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

// Approving a PENDING request flips it to ACTIVE. The service is the authority
// on whether the actor may moderate, so the check is not duplicated here.
export async function POST(request: Request, { params }: Params) {
  const { slug, userId } = await params;
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    await approveMemberService(community.id, user.userId, userId);
    // Approval moves both the member count and the discovery member total.
    await Promise.all([
      invalidateCommunityStats(community.id),
      invalidateCommunityPopulationAggregates(),
    ]);
    logger.info(
      { actorId: user.userId, communityId: community.id, targetUserId: userId },
      "community member approved via api"
    );
    return Response.json(await readMemberState(community.id, userId));
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "member.approve",
      slug,
      userId: user.userId,
    });
  }
}

// Changing a member's role. The role set is validated here as well as in the
// service so a crafted body is rejected as a bad request rather than reaching
// the database layer.
export async function PATCH(request: Request, { params }: Params) {
  const { slug, userId } = await params;
  const user = await requireApiUser();
  if (!user.ok) {
    return user.response;
  }

  const body = objectOf(await readJsonBody(request));
  const role = body?.role;
  if (
    typeof role !== "string" ||
    !ASSIGNABLE_ROLES.has(role as AssignableCommunityRole)
  ) {
    return Response.json(
      { error: "That role cannot be assigned" },
      { status: 400 }
    );
  }

  try {
    const community = await getCommunityBySlug(slug);
    if (!community) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }
    await setMemberRoleService(
      community.id,
      user.userId,
      userId,
      role as AssignableCommunityRole
    );
    logger.info(
      {
        actorId: user.userId,
        communityId: community.id,
        role,
        targetUserId: userId,
      },
      "community member role changed via api"
    );
    return Response.json(await readMemberState(community.id, userId));
  } catch (error) {
    return communityErrorResponse(error, {
      operation: "member.setRole",
      slug,
      userId: user.userId,
    });
  }
}

// A role change moves the badge on the member's profile, so the member's own
// aggregate is refreshed too.
async function readMemberState(
  communityId: string,
  targetUserId: string
): Promise<Record<string, unknown>> {
  const membership = await getMembership(communityId, targetUserId);
  return {
    membership: membership
      ? { role: membership.role, status: membership.status }
      : null,
  };
}
