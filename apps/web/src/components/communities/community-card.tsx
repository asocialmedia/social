"use client";

import type { CommunityData } from "@asm/db";
import { ArrowUpRight, Flame, LayoutGrid, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { getAuraFlameClass } from "@/lib/aura/aura";
import { communityAccentStyle } from "@/lib/communities/accent";
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
      className="sidebar-subcard sidebar-subcard-interactive group/card flex h-full flex-col overflow-hidden rounded-2xl"
      href={`/a/${community.slug}`}
      style={communityAccentStyle(community.accentColor)}
    >
      {/* Header: the real banner when one exists, otherwise a tonal wash so an
          image-less community still reads as itself. Taller than a list tile's
          strip - this is the card's visual anchor. */}
      <div className="relative h-36 w-full shrink-0 overflow-hidden">
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
          <span className="bg-background/85 text-foreground absolute top-3 right-3 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums backdrop-blur-sm">
            18+
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5">
        <div className="relative z-10 -mt-10">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-18"
            name={community.name}
            slug={community.slug}
          />
        </div>

        {/* Identity + the open affordance, on one row: the arrow slides out on
            hover as the card's only interactive cue. */}
        <div className="mt-3.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-foreground truncate text-xl font-bold tracking-tight">
              {community.name}
            </h3>
            <p className="text-muted-foreground truncate text-[13px]">
              a/{community.slug}
            </p>
          </div>
          <ArrowUpRight className="text-muted-foreground group-hover/card:text-foreground mt-1 size-4 shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover/card:translate-x-0 group-hover/card:opacity-100" />
        </div>

        {/* Fixed two-line well so every card's stat row shares a baseline. */}
        <p className="text-muted-foreground mt-2 line-clamp-2 min-h-11 text-[15px]">
          {community.description}
        </p>

        <div className="text-muted-foreground border-border/60 mt-3.5 flex items-center gap-x-5 gap-y-1 border-t pt-3.5 text-[13px]">
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
        </div>
      </div>
    </Link>
  );
}
