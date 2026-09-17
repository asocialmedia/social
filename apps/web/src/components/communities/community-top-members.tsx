"use client";

import { Flame } from "lucide-react";
import Link from "next/link";

import RowBannerWash from "@/components/layouts/row-banner-wash";
import UserAvatar from "@/components/layouts/user-avatar";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { useCommunityMembersQuery } from "@/lib/communities/client";
import { cn, formatNumber } from "@/lib/utils";

import CommunityRoleBadge, {
  isCommunityBadgedRole,
} from "./community-role-badge";

// How many the card lists. The query asks for the same number, so nothing is
// fetched that will not be shown.
const TOP_MEMBERS = 12;

// The community's most valuable members, ranked by the aura they have earned.
// Read-only: the roster card earlier in the rail carries the role controls, so
// this one stays a plain leaderboard rather than a second management surface.
//
// The owner is excluded: they already headline the roster's Owner group, so
// ranking them here just repeats the founder above the people who earned their
// place. One extra row is fetched so filtering the owner still fills the list.
//
// Built on the same row construction as the home rail's leaderboards (avatar,
// name over handle, metric on the second line), so the two rails read as one
// system rather than two different card designs.
export function CommunityTopMembers({ slug }: { slug: string }) {
  const membersQuery = useCommunityMembersQuery(slug, {
    // +1 headroom for the owner, who is dropped below.
    limit: TOP_MEMBERS + 1,
    sort: "aura",
  });
  const members = (membersQuery.data?.members ?? [])
    .filter((member) => member.role !== "OWNER")
    .slice(0, TOP_MEMBERS);

  if (membersQuery.isLoading) {
    return (
      <div className="sidebar-subcard rounded-2xl p-2">
        <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
          <Flame className="size-4 shrink-0 text-orange-500" />
          <h2 className="text-sm font-semibold">Top members</h2>
        </div>
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              className="flex animate-pulse items-center gap-2.5 rounded-lg px-2.5 py-2"
              key={`top-sk-${index}`}
            >
              <div className="bg-muted size-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="bg-muted h-3.5 w-3/4 rounded-md" />
                <div className="bg-muted h-3 w-1/2 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (members.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-subcard rounded-2xl p-2">
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
        <Flame className="size-4 shrink-0 text-orange-500" />
        <h2 className="flex-1 text-sm font-semibold">Top members</h2>
        <span className="text-muted-foreground text-[10px] font-medium">
          by aura
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {members.map((member) => (
          <Link
            className="group relative flex overflow-hidden rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
            href={`/users/${member.user.username}`}
            key={member.user.id}
          >
            {/* The member's header image washed into the row, same treatment as
                the home rail's suggestion rows. */}
            <RowBannerWash bannerUrl={member.user.bannerUrl} />
            {/* Hover tint as its own layer ABOVE the wash and BELOW the
                content: a background on the row itself would paint the banner
                out entirely. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 transition-colors group-hover:bg-[hsl(var(--muted)/0.55)]"
            />

            <span className="relative flex w-full items-center gap-2.5 px-2.5 py-2">
              <UserAvatar
                avatarUrl={member.user.avatarUrl}
                className="size-8 shrink-0"
                seed={member.user.id}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="block min-w-0 flex-1 truncate text-sm font-medium">
                    {member.user.displayName || member.user.username}
                  </span>
                  {isCommunityBadgedRole(member.role) ? (
                    <CommunityRoleBadge roleValue={member.role} />
                  ) : null}
                </span>
                <span className="text-muted-foreground flex items-center gap-1 text-xs transition-colors group-hover:text-inherit">
                  @{member.user.username}
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Flame
                      aria-hidden="true"
                      className={cn(
                        "size-3",
                        getAuraFlameClass(member.user.aura)
                      )}
                    />
                    {formatNumber(member.user.aura)} aura
                  </span>
                </span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
