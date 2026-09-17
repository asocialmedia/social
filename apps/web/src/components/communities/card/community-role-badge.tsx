"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import memberBadge from "@assets/roles/member.png";
import modBadge from "@assets/roles/mod.png";
import ownerBadge from "@assets/roles/owner.png";
import Image from "next/image";
import { memo } from "react";

import { cn } from "@/lib/utils";

// The roles that carry a badge. Mirrors COMMUNITY_BADGED_ROLES in @asm/db;
// kept as a local literal so this client component does not pull the db barrel
// (and its server-only deps) into the browser bundle.
export type CommunityBadgedRole = "MEMBER" | "MODERATOR" | "OWNER";

const ROLE_BADGES: Record<
  CommunityBadgedRole,
  { alt: string; description: string; src: string; title: string }
> = {
  MEMBER: {
    alt: "Community member badge",
    description: "Trusted enough to be named a member of this community",
    src: memberBadge.src,
    title: "Member",
  },
  MODERATOR: {
    alt: "Community moderator badge",
    description: "Keeps this community in order",
    src: modBadge.src,
    title: "Moderator",
  },
  OWNER: {
    alt: "Community owner badge",
    description: "Founded and runs this community",
    src: ownerBadge.src,
    title: "Owner",
  },
};

export function isCommunityBadgedRole(
  role: string | null | undefined
): role is CommunityBadgedRole {
  return role === "MEMBER" || role === "MODERATOR" || role === "OWNER";
}

// One community role banner, sized to the source art's 3:1 ratio (60x20) like
// the account badges, so owner/mod/member sit on the same visual rail as
// author/dev/early rather than reading as a second, unrelated icon set.
// The prop is `roleValue`, not `role`: React would forward a `role` prop to the
// DOM as an ARIA role attribute and the linter rejects "OWNER" as an invalid one.
const CommunityRoleBadge: React.FC<{
  className?: string;
  // The community the role is held in. Shown in the tooltip so a badge on a
  // profile can name where the role comes from.
  communityName?: string;
  roleValue: CommunityBadgedRole;
}> = ({ className, communityName, roleValue }) => {
  const badge = ROLE_BADGES[roleValue];
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={badge.alt}
            className={cn(
              "inline-flex h-5 w-15 shrink-0 items-center justify-center",
              className
            )}
          >
            <Image
              alt=""
              className="h-full w-full object-contain"
              height={20}
              loading="eager"
              priority
              src={badge.src}
              unoptimized
              width={60}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent align="center" className="max-w-56" side="top">
          <span className="text-foreground block text-xs font-semibold">
            {badge.title}
            {communityName ? ` · ${communityName}` : ""}
          </span>
          <span className="text-muted-foreground block text-[11px] leading-tight">
            {badge.description}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default memo(CommunityRoleBadge);
