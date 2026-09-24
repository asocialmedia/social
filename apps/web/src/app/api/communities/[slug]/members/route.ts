import {
  and,
  canViewCommunity,
  getCommunityBySlug,
  getMembership,
  isCommunityModerator,
  prisma,
} from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-members-api" });

// Hard ceiling on one page, whatever the caller asks for. The sidebar cards
// want a dozen names; the members view wants more. Without a cap a crafted
// ?limit=100000 would ask Postgres for the whole roster.
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

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

    // The roster is part of a PRIVATE community's contents. 404 for anyone
    // without an ACTIVE membership, matching the detail and feed routes.
    if (!(await canViewCommunity(community, userId))) {
      return Response.json({ error: "Community not found" }, { status: 404 });
    }

    const canModerate = userId
      ? await isCommunityModerator(community.id, userId)
      : false;
    const wantsPending = includePending && canModerate;

    let memberQuery = prisma.orm.public.CommunityMembers.select(
      "createdAt",
      "role",
      "status"
    )
      .include("user", (user) =>
        user.select(
          "aura",
          "avatarUrl",
          "bannerUrl",
          "displayName",
          "id",
          "username"
        )
      )
      .where((member) =>
        and(
          member.communityId.eq(community.id),
          member.status.eq(wantsPending ? "PENDING" : "ACTIVE")
        )
      );
    if (badgedOnly && !wantsPending) {
      memberQuery = memberQuery.where((member) =>
        member.role.in(["OWNER", "MODERATOR", "MEMBER"])
      );
    }
    const members = await memberQuery
      .orderBy([
        (member) => member.role.asc(),
        (member) => member.createdAt.asc(),
      ])
      .limit(limit)
      .all();
    if (sort === "aura") {
      members.sort(
        (left, right) =>
          (right.user?.aura ?? 0) - (left.user?.aura ?? 0) ||
          left.createdAt.toString().localeCompare(right.createdAt.toString())
      );
    }

    const membership = userId
      ? await getMembership(community.id, userId)
      : null;

    return Response.json({ canModerate, members, membership });
  } catch (error) {
    logger.error({ error: String(error), slug }, "community members failed");
    return Response.json({ error: "Couldn't load members" }, { status: 500 });
  }
}
