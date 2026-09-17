"use client";

import type { CommunityData, CommunityStats } from "@asm/db";
import { formatDate } from "date-fns";
import { Flame } from "lucide-react";

import RowBannerWash from "@/components/layouts/row-banner-wash";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { communityAccentStyle } from "@/lib/communities/accent";
import { cn, formatNumber } from "@/lib/utils";

import CommunityAvatar from "./community-avatar";

// The community's About card. Identity, description and the numbers that
// describe it, in that order: a reader should learn what the space is before
// they meet a single figure.
//
// The community's own header image washes into the card the way a member's
// does in the roster and leaderboard cards, so the rail reads as one system.
// The aura sits in the top-right corner opposite the avatar, because it is the
// one figure that describes the community's output at a glance.
export default function CommunityAboutCard({
  community,
  stats,
}: {
  community: CommunityData;
  stats: CommunityStats;
}) {
  return (
    <section
      className="sidebar-subcard relative overflow-hidden rounded-2xl"
      style={communityAccentStyle(community.accentColor)}
    >
      {/* The community's banner, kept to a top band rather than washing the
          whole card: this surface carries a description and figures that need
          a clean field, unlike a one-line row where the wash can run full
          height. Background layer; the content below is relative. */}
      <RowBannerWash bannerUrl={community.bannerUrl} className="h-[30%]" />

      <div className="relative p-4">
        <div className="flex items-start gap-3">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-11 shrink-0"
            name={community.name}
            slug={community.slug}
          />

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-1.5">
              <h2 className="text-foreground truncate text-sm font-semibold">
                {community.name}
              </h2>
              {/* A genuine access status, so it earns a contained label - the
                  one piece of metadata on this card a reader must not miss. */}
              {community.mature ? (
                <span className="bg-muted text-foreground shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold">
                  18+
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              a/{community.slug}
            </p>
          </div>

          {/* The community's output, opposite the identity mark. */}
          <span
            className="flex shrink-0 items-center gap-1 pt-0.5"
            title="Community aura, the sum of this community's posts"
          >
            <Flame
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                getAuraFlameClass(stats.communityAura)
              )}
            />
            <span className="text-foreground text-sm font-semibold tabular-nums">
              {formatNumber(stats.communityAura)}
            </span>
            <span className="sr-only">community aura</span>
          </span>
        </div>

        <p className="text-muted-foreground mt-3 text-sm leading-relaxed text-pretty">
          {community.description}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4">
          <AboutStat label="Members" value={stats.members} />
          <AboutStat label="Weekly visitors" value={stats.weeklyVisitors} />
        </dl>

        <p className="text-muted-foreground mt-4 text-xs">
          Created {formatDate(new Date(community.createdAt), "MMMM d, yyyy")}
        </p>
      </div>
    </section>
  );
}

function AboutStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground truncate text-[11px]">{label}</dt>
      <dd className="text-foreground mt-0.5 text-lg leading-none font-semibold tabular-nums">
        {formatNumber(value)}
      </dd>
    </div>
  );
}
