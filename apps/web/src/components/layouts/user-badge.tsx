"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import asmLogo from "@assets/asm.png";
import authorBadge from "@assets/roles/author.png";
import devBadge from "@assets/roles/dev.png";
import earlyBadge from "@assets/roles/early.png";
import shitposterBadge from "@assets/roles/shitposter.png";
import Image from "next/image";
import { memo } from "react";

import { cn } from "@/lib/utils";

import { normalizeBadges } from "./user-badge-utils";
import type { UserBadgeType } from "./user-badge-utils";

export type { UserBadgeType } from "./user-badge-utils";
export { normalizeBadge, normalizeBadges } from "./user-badge-utils";

const BADGE_IMAGES: Record<UserBadgeType, { src: string; alt: string }> = {
  author: { alt: "Author badge", src: authorBadge.src },
  dev: { alt: "Developer badge", src: devBadge.src },
  early: { alt: "Early supporter badge", src: earlyBadge.src },
  shitposter: { alt: "Shitposter badge", src: shitposterBadge.src },
};

// Custom tooltip copy shown when hovering the banner: a short label plus a
// slightly cheeky line about what the role means around here.
const BADGE_TOOLTIPS: Record<
  UserBadgeType,
  { title: string; description: string }
> = {
  author: {
    description: "Creator of asocialmedia, the one who started it all",
    title: "Author",
  },
  dev: {
    description: "Builds the stuff you're scrolling through",
    title: "Developer",
  },
  early: {
    description: "OG, here before it was cool",
    title: "Early supporter",
  },
  shitposter: {
    description: "A menace to the feed and everyone on it",
    title: "Shitposter",
  },
};

// Blue-tick style role banners shown next to a username. The source images are
// wide 3:1 banners, so the box matches that ratio (60x20) instead of squishing
// them into a square. The first badge renders inline; any extras collapse into
// a "+N" chip. Hovering surfaces a tooltip listing every badge; pass a
// className to scale the primary banner up next to larger headings.
const UserBadge: React.FC<{
  badge?: string | null;
  badges?: string[] | null;
  className?: string;
}> = ({ badge, badges, className }) => {
  let primary: (string | null | undefined)[];
  if (badges && badges.length > 0) {
    primary = badges;
  } else if (badge) {
    primary = [badge];
  } else {
    primary = [];
  }
  const list = normalizeBadges(primary);
  if (list.length === 0) {
    return null;
  }
  const [primaryType, ...rest] = list;
  const { alt, src } = BADGE_IMAGES[primaryType];
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={alt}
            className="inline-flex shrink-0 items-center gap-1"
          >
            <span
              className={cn(
                "inline-flex h-5 w-15 items-center justify-center",
                className
              )}
            >
              <Image
                alt=""
                className="h-full w-full object-contain"
                height={20}
                loading="eager"
                priority
                src={src}
                unoptimized
                width={60}
              />
            </span>
            {rest.length > 0 ? (
              <span
                aria-label={`${rest.length} more badge${rest.length === 1 ? "" : "s"}`}
                className="bg-muted text-muted-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold"
              >
                +{rest.length}
              </span>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent
          align="center"
          className="apple-panel max-w-64 bg-transparent shadow-none"
          side="top"
        >
          <div className="flex flex-col gap-2">
            {list.map((type) => {
              const tooltip = BADGE_TOOLTIPS[type];
              return (
                <div className="flex items-center gap-2.5" key={type}>
                  <Image
                    alt=""
                    className="h-5 w-15 shrink-0 object-contain"
                    height={20}
                    src={BADGE_IMAGES[type].src}
                    unoptimized
                    width={60}
                  />
                  <div className="min-w-0 text-left">
                    <span className="text-foreground block text-xs font-semibold whitespace-nowrap">
                      {tooltip.title}
                    </span>
                    <span className="text-muted-foreground block max-w-44 text-[11px] leading-tight">
                      {tooltip.description}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-2.5 pt-1">
              <Image
                alt="asocialmedia logo"
                className="size-6 shrink-0 rounded-md object-contain"
                height={24}
                src={asmLogo}
                unoptimized
                width={32}
              />
              <span className="text-muted-foreground text-[11px] leading-tight">
                asocialmedia
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default memo(UserBadge);
