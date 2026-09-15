"use client";

import type { CommunityData, CommunityStats, UserData } from "@asm/db";
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
      <section className="border-border/60 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-10"
            name={community.name}
            slug={community.slug}
          />
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-semibold">
              {community.name}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              a/{community.slug}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          {community.description}
        </p>
        {community.topics.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {community.topics.map((topic) => (
              <span className="text-muted-foreground text-xs" key={topic}>
                #{topic}
              </span>
            ))}
          </div>
        ) : null}
        <p className="text-muted-foreground mt-3 text-xs">
          Created {formatDate(new Date(community.createdAt), "MMMM d, yyyy")}
        </p>
      </section>

      <section className="border-border/60 rounded-2xl border p-4">
        <h2 className="text-foreground mb-3 text-sm font-semibold">About</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Weekly visitors" value={stats.weeklyVisitors} />
          <Stat label="Contributors" value={stats.contributors} />
          <Stat label="Members" value={stats.members} />
          <Stat label="Community aura" value={stats.communityAura} withFlame />
        </dl>
        <div className="border-border/60 mt-3 flex items-center justify-between border-t pt-3">
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
      </section>

      {owner ? (
        <section className="border-border/60 rounded-2xl border p-4">
          <h2 className="text-foreground mb-3 text-sm font-semibold">
            Created by
          </h2>
          <Link
            className="flex items-center gap-2.5"
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
