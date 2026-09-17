"use client";

import type { CommunityData } from "@asm/db";
import { Badge } from "@asm/ui/shadui/badge";
import { formatDate } from "date-fns";
import { ArrowUpRight, Flame, LayoutGrid, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { getAuraFlameClass } from "@/lib/aura/aura";
import { communityAccentStyle } from "@/lib/communities/accent";
import { formatCommunityAge } from "@/lib/communities/age";
import { cn, formatNumber } from "@/lib/utils";

import CommunityAvatar from "./community-avatar";

// Discovery card. Deliberately larger and more editorial than a list tile: a
// tall banner header (the real image when there is one, otherwise a tonal wash
// drawn from the community's accent), the mark overlapping it, then the
// identity and three stats. The whole card is one link - there is no join
// action here, so the card's only job is to open the community.
export default function CommunityCard({
  aura = 0,
  community,
}: {
  aura?: number;
  community: CommunityData;
}) {
  const [bannerFailed, setBannerFailed] = useState(false);
  const { members, posts } = community._count;
  const hasBanner = Boolean(community.bannerUrl) && !bannerFailed;

  return (
    <Link
      // `isolate` is load-bearing. The mark below is pulled up over the banner
      // with `relative z-10`, and without a stacking context on this root that
      // z-index leaks into the page: as a same-z-index, later-in-DOM sibling it
      // then painted OVER the communities page's sticky search bar (also z-10)
      // when a rail card scrolled past it. Isolation confines the card's
      // internal z-index so the sticky chrome always wins.
      className="sidebar-subcard sidebar-subcard-interactive group/card isolate flex h-full flex-col overflow-hidden rounded-2xl"
      href={`/a/${community.slug}`}
      style={communityAccentStyle(community.accentColor)}
    >
      {/* Header: the real banner when one exists, otherwise a tonal wash so an
          image-less community still reads as itself. Taller than a list tile's
          strip - this is the card's visual anchor. On mobile the whole card is
          scaled down a notch (banner, mark and padding all step up at `sm`) so a
          single-column card does not dominate the phone viewport. */}
      <div className="relative h-28 w-full shrink-0 overflow-hidden sm:h-36">
        {hasBanner ? (
          <Image
            alt=""
            className="object-cover"
            fill
            onError={() => setBannerFailed(true)}
            sizes="(max-width: 640px) 100vw, 420px"
            src={community.bannerUrl as string}
            unoptimized
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--community-accent) 30%, hsl(var(--muted))), hsl(var(--muted)))",
            }}
          />
        )}
        {/* Feather the header into the card surface so the image never ends in
            a hard horizontal line behind the mark. */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[hsl(var(--background-alt))]" />

        {community.mature ? (
          // Badge brings the app's 3D chip surface (chip-3d: hairline edge plus
          // the inner lip). `variant="outline"` is deliberate: the other variants
          // set their own bg-* utility, which would beat chip-3d's surface in the
          // cascade, and `default` also carries a hover fill that would flash
          // brand orange on a content badge. bg-muted is chip-3d's own background
          // value, so the surface reads identically while keeping the lip.
          <Badge
            className="bg-muted text-foreground absolute top-3 right-3 px-1.5 py-0.5 text-[11px] tabular-nums"
            variant="outline"
          >
            18+
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="relative z-10 -mt-8 sm:-mt-10">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-14 sm:size-18"
            name={community.name}
            slug={community.slug}
          />
        </div>

        {/* Identity + the open affordance, on one row: the arrow slides out on
            hover as the card's only interactive cue. */}
        <div className="mt-3 flex items-start justify-between gap-2 sm:mt-3.5">
          <div className="min-w-0">
            <h3 className="text-foreground truncate text-lg font-bold tracking-tight sm:text-xl">
              {community.name}
            </h3>
            <p className="text-muted-foreground truncate text-[13px]">
              a/{community.slug}
            </p>
          </div>
          <ArrowUpRight className="text-muted-foreground group-hover/card:text-foreground mt-1 size-4 shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover/card:translate-x-0 group-hover/card:opacity-100" />
        </div>

        {/* Fixed two-line well so every card's stat row shares a baseline. */}
        <p className="text-muted-foreground mt-2 line-clamp-2 min-h-10 text-sm sm:min-h-11 sm:text-[15px]">
          {community.description}
        </p>

        <div className="text-muted-foreground border-border/60 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[13px] sm:mt-3.5 sm:gap-x-5 sm:pt-3.5">
          <span
            className="flex items-center gap-1.5"
            title="Community aura - the total aura of every post in this community"
          >
            <Flame
              aria-hidden="true"
              className={cn("size-4 shrink-0", getAuraFlameClass(aura))}
            />
            <span className="text-foreground font-semibold tabular-nums">
              {formatNumber(aura)}
            </span>
            <span className="sr-only">aura</span>
          </span>
          <span className="flex items-center gap-1.5" title="Members">
            <Users
              aria-hidden="true"
              className="text-primary size-4 shrink-0"
              fill="currentColor"
            />
            <span className="text-foreground font-semibold tabular-nums">
              {formatNumber(members)}
            </span>
            <span className="sr-only">members</span>
          </span>
          <span className="flex items-center gap-1.5" title="Posts">
            <LayoutGrid
              aria-hidden="true"
              className="text-primary size-4 shrink-0"
              fill="currentColor"
            />
            <span className="text-foreground font-semibold tabular-nums">
              {formatNumber(posts)}
            </span>
            <span className="sr-only">posts</span>
          </span>

          {/* Age of the community, filling the stat row's trailing space. It
              stays muted while the stats above are bold and coloured, so it
              reads as a quiet aside rather than a fourth metric. The exact date
              lives in the title (matching the detail page's own "Created"
              line) since the label itself is relative.

              The row wraps so this can drop to its own right-aligned line on a
              very narrow card (320px) rather than spilling past the row - a
              `nowrap` item with `ml-auto` cannot shrink, so it used to overflow
              by ~20px there. `ml-auto` still right-aligns it on whichever line
              it lands. */}
          <span
            className="ml-auto shrink-0 pl-2 text-xs whitespace-nowrap"
            title={formatDate(new Date(community.createdAt), "MMMM d, yyyy")}
          >
            {formatCommunityAge(community.createdAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
