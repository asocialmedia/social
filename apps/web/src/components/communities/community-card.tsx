"use client";

import type { CommunityData, CommunityStats } from "@asm/db";
import Link from "next/link";

import { useSession } from "@/app/(main)/session-provider";
import { communityAccentStyle } from "@/lib/communities/accent";
import { formatNumber } from "@/lib/utils";

import CommunityAvatar from "./community-avatar";
import JoinButton from "./join-button";

// Discovery card. A community is presented by its real mark, name, a short
// description and its member count. No glow, no hover-lift, no icon tile: the
// accent is a single tonal rail on the left edge, matching the post card.
export default function CommunityCard({
  community,
  stats,
  joined = false,
}: {
  community: CommunityData;
  stats?: CommunityStats;
  joined?: boolean;
}) {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const members = stats?.members ?? community._count.members;

  return (
    <div
      className="group border-border/60 relative flex flex-col gap-3 rounded-2xl border bg-[hsl(var(--background))] p-4"
      style={communityAccentStyle(community.accentColor)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-3 left-0 w-0.5 rounded-full bg-[var(--community-accent)] dark:bg-[var(--community-accent-dark)]"
      />
      <div className="flex items-start gap-3">
        <CommunityAvatar
          accentColor={community.accentColor}
          avatarUrl={community.avatarUrl}
          className="size-12"
          name={community.name}
          slug={community.slug}
        />
        <div className="min-w-0 flex-1">
          <Link
            className="text-foreground block truncate text-sm font-semibold hover:underline"
            href={`/a/${community.slug}`}
          >
            {community.name}
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            a/{community.slug} · {formatNumber(members)} member
            {members === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <p className="text-muted-foreground line-clamp-2 min-h-8 text-sm">
        {community.description}
      </p>
      <div className="mt-auto">
        <JoinButton
          communityId={community.id}
          initialMembership={
            joined ? { role: "MEMBER", status: "ACTIVE" } : null
          }
          isLoggedIn={isLoggedIn}
          slug={community.slug}
        />
      </div>
    </div>
  );
}
