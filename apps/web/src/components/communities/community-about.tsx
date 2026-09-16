"use client";

import type { CommunityData, CommunityStats, UserData } from "@asm/db";
import { Badge } from "@asm/ui/shadui/badge";
import { formatDate } from "date-fns";
import { Flame } from "lucide-react";
import Link from "next/link";

import UserAvatar from "@/components/layouts/user-avatar";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { communityAccentStyle } from "@/lib/communities/accent";
import { formatNumber } from "@/lib/utils";

import CommunityAvatar from "./community-avatar";
import { CommunityMembers } from "./community-members";

// Community sidebar: the about block. Ordered identity -> description ->
// creation -> activity -> totals -> moderation, so the eye lands on what the
// community is before the numbers.
export default function CommunityAbout({
  community,
  membership,
  owner,
  stats,
}: {
  community: CommunityData;
  membership: {
    role: "MEMBER" | "MODERATOR" | "OWNER";
    status: "ACTIVE" | "PENDING";
  } | null;
  owner: Pick<UserData, "avatarUrl" | "displayName" | "id" | "username"> | null;
  stats: CommunityStats;
}) {
  const isModerator =
    membership?.status === "ACTIVE" &&
    (membership.role === "OWNER" || membership.role === "MODERATOR");

  return (
    <div
      className="flex flex-col gap-4"
      style={communityAccentStyle(community.accentColor)}
    >
      {/* One About card rather than two stacked ones: identity, description and
          the numbers all describe the same subject, so splitting them just made
          the rail taller without adding a distinction a reader could name. The
          surface is the app's raised recipe (sidebar-subcard), matching every
          other rail card. */}
      <section className="sidebar-subcard rounded-2xl p-4">
        <h2 className="text-foreground mb-3 text-sm font-semibold">About</h2>

        <div className="flex items-center gap-3">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-11"
            name={community.name}
            slug={community.slug}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-foreground truncate text-sm font-semibold">
                {community.name}
              </p>
              {/* A real status, so it earns a chip here: the one case a
                  contained label beats plain text. */}
              {community.mature ? (
                <Badge
                  className="bg-muted text-foreground shrink-0 px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
                  variant="outline"
                >
                  18+
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              a/{community.slug}
            </p>
          </div>
        </div>

        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {community.description}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Weekly visitors" value={stats.weeklyVisitors} />
          <Stat label="Contributors" value={stats.contributors} />
          <Stat label="Members" value={stats.members} />
          <Stat label="Community aura" value={stats.communityAura} withFlame />
        </dl>

        {/* Combined member aura as a tonal row: hierarchy from the surface
            shift, not a hairline rule drawn across the card. */}
        <div className="bg-muted/50 mt-3 flex items-center justify-between rounded-xl px-3 py-2">
          <span className="text-muted-foreground text-xs">
            Combined member aura
          </span>
          <span className="text-foreground inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
            <Flame
              className={["size-4", getAuraFlameClass(stats.memberAura)].join(
                " "
              )}
            />
            {formatNumber(stats.memberAura)}
          </span>
        </div>

        {/* Both lines stay left-aligned on the card's own margin. Pushing the
            date to the right with ml-auto stranded it at the far edge opposite
            the topics, leaving a dead gulf in the middle of a two-item row. */}
        <div className="text-muted-foreground mt-3 space-y-1 text-xs">
          {community.topics.length > 0 ? (
            <p className="flex flex-wrap gap-x-2.5 gap-y-1">
              {community.topics.map((topic) => (
                <span key={topic}>#{topic}</span>
              ))}
            </p>
          ) : null}
          <p>
            Created {formatDate(new Date(community.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
      </section>

      {owner ? (
        <section className="sidebar-subcard rounded-2xl p-4">
          <h2 className="text-foreground mb-2 text-sm font-semibold">
            Created by
          </h2>
          <Link
            className="hover:bg-muted/60 -mx-1 flex items-center gap-2.5 rounded-xl px-1 py-1 transition-colors"
            href={`/users/${owner.username}`}
          >
            <UserAvatar
              avatarUrl={owner.avatarUrl}
              className="size-8"
              user={owner}
            />
            <span className="min-w-0">
              <span className="text-foreground block truncate text-sm font-medium">
                {owner.displayName || owner.username}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                @{owner.username}
              </span>
            </span>
          </Link>
        </section>
      ) : null}

      <CommunityMembers
        canModerate={isModerator}
        communityId={community.id}
        slug={community.slug}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  withFlame = false,
}: {
  label: string;
  value: number;
  withFlame?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground inline-flex items-center gap-1 text-base font-semibold tabular-nums">
        {withFlame ? (
          <Flame className={["size-4", getAuraFlameClass(value)].join(" ")} />
        ) : null}
        {formatNumber(value)}
      </dd>
    </div>
  );
}
