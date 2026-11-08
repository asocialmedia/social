// Native port of web's community-role-badge.tsx role contract
// (apps/web/src/components/communities/card/community-role-badge.tsx).
// The label/tone mapping lives here so it is unit-testable; the art files
// are the same PNGs as web (apps/web/assets/roles), copied into the native
// asset catalog.
import memberBadge from "@/assets/images/roles/member.png";
import modBadge from "@/assets/images/roles/mod.png";
import ownerBadge from "@/assets/images/roles/owner.png";

export type CommunityBadgedRole = "MEMBER" | "MODERATOR" | "OWNER";

export function isCommunityBadgedRole(
  role: string | null | undefined
): role is CommunityBadgedRole {
  return role === "MEMBER" || role === "MODERATOR" || role === "OWNER";
}

export const COMMUNITY_BADGE_ART: Record<CommunityBadgedRole, number> = {
  MEMBER: memberBadge,
  MODERATOR: modBadge,
  OWNER: ownerBadge,
};

export const COMMUNITY_BADGE_META: Record<
  CommunityBadgedRole,
  { description: string; label: string }
> = {
  MEMBER: {
    description: "Trusted enough to be named a member of this community",
    label: "Member",
  },
  MODERATOR: {
    description: "Keeps this community in order",
    label: "Moderator",
  },
  OWNER: {
    description: "Founded and runs this community",
    label: "Owner",
  },
};
