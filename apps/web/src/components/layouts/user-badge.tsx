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
import Image from "next/image";
import { memo } from "react";

import { cn } from "@/lib/utils";

export type UserBadgeType = "author" | "dev" | "early";

const BADGE_IMAGES: Record<UserBadgeType, { src: string; alt: string }> = {
  author: { alt: "Author badge", src: authorBadge.src },
  dev: { alt: "Developer badge", src: devBadge.src },
  early: { alt: "Early supporter badge", src: earlyBadge.src },
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
};

// Maps a stored user badge value to a known type. Unknown values render
// nothing so a bad DB toggle never shows a broken image.
export function normalizeBadge(
  value: string | null | undefined
): UserBadgeType | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "author" ||
    normalized === "dev" ||
    normalized === "early"
  ) {
    return normalized;
  }
  return null;
}

// Blue-tick style role banner shown next to a username. The source images are
// wide 3:1 banners, so the box matches that ratio (60x20) instead of squishing
// them into a square. Hovering surfaces a custom tooltip describing the role;
// pass a className to scale the banner up next to larger headings.
const UserBadge: React.FC<{
  badge: string | null | undefined;
  className?: string;
}> = ({ badge, className }) => {
  const type = normalizeBadge(badge);
  if (!type) {
    return null;
  }
  const { alt, src } = BADGE_IMAGES[type];
  const tooltip = BADGE_TOOLTIPS[type];
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={alt}
            className={cn(
              "inline-flex h-5 w-15 shrink-0 items-center justify-center",
              className
            )}
          >
            <Image
              alt=""
              className="h-full w-full object-contain"
              height={20}
              src={src}
              unoptimized
              width={60}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent
          align="center"
          className="apple-panel max-w-64 bg-transparent shadow-none"
          side="top"
        >
          <div className="flex items-center gap-2.5">
            <Image
              alt="asocialmedia logo"
              className="size-8 shrink-0 rounded-md object-contain"
              height={36}
              src={asmLogo}
              unoptimized
              width={48}
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
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default memo(UserBadge);
