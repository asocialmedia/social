import type { Prisma } from "../../prisma/generated/prisma/client";

// The row-level companion to canViewCommunity, for post reads that are NOT
// already scoped to one community (global feeds, search, profiles, sitemaps,
// and thread ancestry). A post inside a PRIVATE community must not surface
// there except to that community's ACTIVE members: global posts and
// PUBLIC/RESTRICTED community posts stay visible to everyone. A reshare is
// judged by the community it carries, so resurfacing a private post onto the
// global feed cannot route around the rule. Merge into a query as
// `{ AND: [where, visibility] }` so an existing OR is preserved.
//
// Lives in its own module (not communities/service.ts) so low-level readers
// like posts/ancestors.ts can apply it without pulling in the community
// service and risking an import cycle.
export function communityVisibilityWhere(
  userId: string
): Prisma.PostWhereInput {
  // A community the viewer may read: any non-private community, or a private
  // one they hold an ACTIVE membership in.
  const readableCommunity: Prisma.CommunityWhereInput = userId
    ? {
        OR: [
          { type: { not: "PRIVATE" } },
          { members: { some: { status: "ACTIVE", userId } } },
        ],
      }
    : { type: { not: "PRIVATE" } };

  return {
    OR: [
      // Plain global post (no community, no reshare source).
      { communityId: null, communityShare: null },
      // Native community post.
      { community: readableCommunity },
      // Global reshare of a community post.
      {
        communityShare: {
          is: { community: readableCommunity },
        },
      },
    ],
  };
}
