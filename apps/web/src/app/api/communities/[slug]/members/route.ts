import {
  getCommunityBySlug,
  getMembership,
  isCommunityModerator,
  prisma,
} from "@asm/db";
import type { Prisma } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-members-api" });

// Hard ceiling on one page, whatever the caller asks for. The sidebar cards
// want a dozen names; the members view wants more. Without a cap a crafted
// ?limit=100000 would ask Postgres for the whole roster.
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// Role ordering for the roster: owner first, then moderators, then members,
// then plain participants. The enum's own ordinal order already runs this way,
// so an ascending sort is enough - kept explicit here so a future enum edit
// cannot silently reorder the list.
const ROLE_ORDER: Prisma.CommunityMemberOrderByWithRelationInput[] = [
  { role: "asc" },
  { createdAt: "asc" },
];

// Leaderboard ordering: highest aura first, then a stable tiebreaker.
const AURA_ORDER: Prisma.CommunityMemberOrderByWithRelationInput[] = [
  { user: { aura: "desc" } },
  { createdAt: "asc" },
];

// Community members. Pending requests are only visible to the owner/moderators;
// everyone else sees the active member list.
//
// Query params (all optional):
//   pending=1  - list PENDING join requests instead of active members. Ignored
//                unless the caller can moderate, so it can never leak requests.
//   sort=aura  - rank by member aura instead of role. Default is role order.
//   badged=1   - only members holding a role badge (owner/moderator/member).
//                Participants are the default state, so the roster card asks
//                for this to avoid listing every joiner.
//   limit=N    - page size, clamped to MAX_LIMIT.
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const url = new URL(request.url);
  const includePending = url.searchParams.get("pending") === "1";
  const badgedOnly = url.searchParams.get("badged") === "1";
  const sort = url.searchParams.get("sort") === "aura" ? "aura" : "role";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

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
      orderBy: sort === "aura" ? AURA_ORDER : ROLE_ORDER,
      select: {
        createdAt: true,
        role: true,
        status: true,
        user: {
          select: {
            aura: true,
            avatarUrl: true,
            // Carried so a member row can paint the same banner wash the home
            // rail's suggestion rows use, giving each person the same top-left
            // image treatment.
            bannerUrl: true,
            displayName: true,
            id: true,
            username: true,
          },
        },
      },
      take: limit,
      where: {
        communityId: community.id,
        status: wantsPending ? "PENDING" : "ACTIVE",
        // Participants carry no badge, so the roster card filters them out at
        // the query rather than fetching rows it will not render.
        ...(badgedOnly && !wantsPending
          ? { role: { in: ["OWNER", "MODERATOR", "MEMBER"] } }
          : {}),
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
