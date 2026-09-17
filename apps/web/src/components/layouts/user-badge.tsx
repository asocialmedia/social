"use client";

// oxlint-disable jsx-a11y/prefer-tag-over-role -- the badge trigger must be a
// span, never a button: it renders inside an outer <button> (the sidebar's
// profile-popover trigger) and inside <Link>s (feed and rail rows), and nested
// interactive elements are invalid HTML - the parser auto-closes them and
// hydration breaks. The span carries role, tabIndex and Enter/Space handling,
// so its behaviour matches a button.

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@asm/ui/shadui/hover-card";
import authorBadge from "@assets/roles/author.png";
import devBadge from "@assets/roles/dev.png";
import earlyBadge from "@assets/roles/early.png";
import memberRoleBadge from "@assets/roles/member.png";
import modRoleBadge from "@assets/roles/mod.png";
import ownerRoleBadge from "@assets/roles/owner.png";
import shitposterBadge from "@assets/roles/shitposter.png";
import trendingBadge from "@assets/roles/trending.png";
import Image from "next/image";
import Link from "next/link";
import { memo, useState } from "react";

import CommunityAvatar from "@/components/communities/community-avatar";
import { cn } from "@/lib/utils";

import { badgeRank, normalizeBadges } from "./user-badge-utils";
import type { UserBadgeType } from "./user-badge-utils";

export type { UserBadgeType } from "./user-badge-utils";
export { normalizeBadge, normalizeBadges } from "./user-badge-utils";

// Community roles that render in the same rail as the account badges. Kept as a
// local union (mirroring @asm/db's COMMUNITY_BADGED_ROLES) so this client
// component does not drag the db barrel - and its server-only deps - into the
// browser bundle.
export type CommunityRoleBadgeType = "MEMBER" | "MODERATOR" | "OWNER";

// The communities a role was earned in, for the popover's link rows.
export interface CommunityRoleCommunity {
  accentColor: string;
  avatarUrl: string | null;
  name: string;
  slug: string;
}

// The minimum shape the role prop needs: the role plus the community it was
// held in. Both a user payload's `communityMemberships` and the profile's role
// rows satisfy it, so callers pass either without reshaping.
export interface CommunityRoleLike {
  community?: CommunityRoleCommunity | null;
  role: string;
}

// One badge's art and copy, shared by the inline rail and the popover.
interface BadgeMeta {
  alt: string;
  description: string;
  key: string;
  src: string;
  title: string;
}

const ACCOUNT_BADGE_META: Record<UserBadgeType, BadgeMeta> = {
  author: {
    alt: "Author badge",
    description: "Creator of asocialmedia, the one who started it all",
    key: "author",
    src: authorBadge.src,
    title: "Author",
  },
  dev: {
    alt: "Developer badge",
    description: "Builds the stuff you're scrolling through",
    key: "dev",
    src: devBadge.src,
    title: "Developer",
  },
  early: {
    alt: "Early supporter badge",
    description: "OG, here before it was cool",
    key: "early",
    src: earlyBadge.src,
    title: "Early supporter",
  },
  shitposter: {
    alt: "Shitposter badge",
    description: "A menace to the feed and everyone on it",
    key: "shitposter",
    src: shitposterBadge.src,
    title: "Shitposter",
  },
  trending: {
    alt: "Trending badge",
    description: "Currently on the trending card, held while you are there",
    key: "trending",
    src: trendingBadge.src,
    title: "Trending",
  },
};

const COMMUNITY_BADGE_META: Record<CommunityRoleBadgeType, BadgeMeta> = {
  MEMBER: {
    alt: "Community member badge",
    description: "Trusted enough to be named a member of a community",
    key: "community-member",
    src: memberRoleBadge.src,
    title: "Member",
  },
  MODERATOR: {
    alt: "Community moderator badge",
    description: "Keeps a community in order",
    key: "community-moderator",
    src: modRoleBadge.src,
    title: "Moderator",
  },
  OWNER: {
    alt: "Community owner badge",
    description: "Founded and runs a community",
    key: "community-owner",
    src: ownerRoleBadge.src,
    title: "Owner",
  },
};

// Owner before moderator before member.
const COMMUNITY_ROLE_ORDER: CommunityRoleBadgeType[] = [
  "OWNER",
  "MODERATOR",
  "MEMBER",
];

function isBadgedRole(role: string): role is CommunityRoleBadgeType {
  return role === "OWNER" || role === "MODERATOR" || role === "MEMBER";
}

// Collapses the user's role rows into one entry per distinct role, each
// carrying the communities it was earned in. A person can own several, so the
// banner is per ROLE and the popover lists the communities under it.
function groupCommunityRoles(
  roles: readonly CommunityRoleLike[]
): { communities: CommunityRoleCommunity[]; role: CommunityRoleBadgeType }[] {
  const byRole = new Map<CommunityRoleBadgeType, CommunityRoleCommunity[]>();
  const seen = new Map<CommunityRoleBadgeType, Set<string>>();
  for (const entry of roles) {
    if (!isBadgedRole(entry.role) || !entry.community?.slug) {
      continue;
    }
    const bucket = byRole.get(entry.role) ?? [];
    const ids = seen.get(entry.role) ?? new Set<string>();
    // A user can only hold one role per community, but the payload is a list;
    // dedupe by slug so a duplicated row cannot draw the same link twice.
    if (!ids.has(entry.community.slug)) {
      ids.add(entry.community.slug);
      bucket.push(entry.community);
    }
    byRole.set(entry.role, bucket);
    seen.set(entry.role, ids);
  }
  return COMMUNITY_ROLE_ORDER.filter((role) => byRole.has(role)).map(
    (role) => ({
      communities: byRole.get(role) ?? [],
      role,
    })
  );
}

// Role banners shown next to a username. The source images are wide 3:1
// banners, so the box matches that ratio (60x20) instead of squishing them into
// a square. The first badge renders inline; any extras collapse into a "+N"
// chip. Clicking opens a panel listing every badge - and, for community roles,
// the communities themselves as links.
//
// A click panel rather than a hover tooltip: the community rows are links, and
// a tooltip dismisses the moment the pointer leaves the trigger, so its links
// could never be reached.
const UserBadge: React.FC<{
  badge?: string | null;
  badges?: string[] | null;
  className?: string;
  // Community role rows (owner/moderator/member) to show alongside the account
  // badges. One banner per distinct role.
  communityRoles?: readonly CommunityRoleLike[] | null;
  // When false, render only the rail: no hover card, no interactive wrapper.
  // Required wherever the badge sits inside another popover's content, because
  // nesting a Radix popover inside a popover makes the inner one render open
  // alongside the outer. Also right inside the sidebar profile-popover trigger,
  // where the whole row is already one control.
  interactive?: boolean;
}> = ({ badge, badges, className, communityRoles, interactive = true }) => {
  const [open, setOpen] = useState(false);

  // Always merge the legacy `badge` column with the `badges` array so a badge
  // stored in either location renders (author in the legacy column + early in
  // the array shows both). normalizeBadges dedupes and sorts by the unified
  // display precedence, which also covers the community roles.
  const primary = [...(badges ?? []), ...(badge ? [badge] : [])];
  const accountList = normalizeBadges(primary);
  const communityGroups = groupCommunityRoles(communityRoles ?? []);

  // One ordered list across BOTH families. Platform badges and community roles
  // are ranked by the same table (author -> owner -> moderator -> dev ->
  // shitposter -> member -> early), so they interleave on significance rather
  // than rendering as two blocks with every role after every platform badge.
  //
  // Ranked by the badge/role value itself, not by meta.key: role keys are
  // namespaced ("community-owner") and would not match the precedence table.
  const ranked = [
    ...accountList.map((type) => ({
      communities: [] as CommunityRoleCommunity[],
      kind: "platform" as const,
      meta: ACCOUNT_BADGE_META[type],
      rank: badgeRank(type),
    })),
    ...communityGroups.map(({ communities, role }) => ({
      communities,
      kind: "role" as const,
      meta: COMMUNITY_BADGE_META[role],
      rank: badgeRank(role),
    })),
  ].toSorted((a, b) => a.rank - b.rank);

  if (ranked.length === 0) {
    return null;
  }

  const [primaryEntry, ...rest] = ranked;
  const restCount = rest.length;

  const rail = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1",
        interactive && "cursor-pointer"
      )}
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
          src={primaryEntry.meta.src}
          unoptimized
          width={60}
        />
      </span>
      {restCount > 0 ? (
        <span
          aria-label={`${restCount} more badge${restCount === 1 ? "" : "s"}`}
          className="bg-muted text-muted-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold"
        >
          +{restCount}
        </span>
      ) : null}
    </span>
  );

  if (!interactive) {
    return rail;
  }

  return (
    // HoverCard, not Popover/Tooltip. It opens on hover AND has a "grace area":
    // the pointer may travel from the badge down into the panel (across the
    // gap) without the panel closing, which is what makes the community links
    // inside reachable. A plain Tooltip closes the moment the pointer leaves
    // the trigger, so its links were never clickable.
    //
    // `open`/`onOpenChange` are passed only to mirror Radix's own hover state
    // for aria-expanded; the open/close timing is still Radix's.
    //
    // The trigger is a span, never a button: the badge renders inside an outer
    // <button> (the sidebar's profile-popover trigger) and inside <Link>s (feed
    // and rail rows), and nested interactive elements are invalid HTML - the
    // parser auto-closes them and hydration breaks. The span carries role,
    // tabIndex and Enter/Space handling instead.
    <HoverCard
      onOpenChange={setOpen}
      open={open}
      openDelay={140}
      closeDelay={120}
    >
      <HoverCardTrigger asChild>
        <span
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={primaryEntry.meta.alt}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1"
          onClick={(event) => {
            // stopPropagation keeps an ancestor's onSelect/onClick from firing;
            // preventDefault suppresses an ancestor <a>'s navigation, which
            // would otherwise still run since default actions ignore
            // propagation. Opening is then driven explicitly, so a tap also
            // works on touch screens, where there is no hover.
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            // A span is not keyboard-activated for free the way a real button
            // is, so Enter/Space are wired up by hand.
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              setOpen((previous) => !previous);
            }
          }}
          role="button"
          tabIndex={0}
        >
          {rail}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="panel-3d text-popover-foreground border-border/70 w-64 gap-0 rounded-xl border p-2.5 shadow-none"
        side="bottom"
        sideOffset={6}
      >
        <div className="flex flex-col">
          {/* Rows follow the same unified order as the inline rail, so the
              panel and the banner agree on what leads. */}
          {ranked.map((item) =>
            item.kind === "platform" ? (
              <div
                className="flex items-start gap-2.5 px-1 py-1"
                key={item.meta.key}
              >
                <Image
                  alt=""
                  className="mt-0.5 h-5 w-15 shrink-0 object-contain"
                  height={20}
                  src={item.meta.src}
                  unoptimized
                  width={60}
                />
                <div className="min-w-0 flex-1 text-left">
                  <span className="text-foreground block text-xs font-semibold">
                    {item.meta.title}
                  </span>
                  <span className="text-muted-foreground block text-[11px] leading-tight">
                    {item.meta.description}
                  </span>
                </div>
              </div>
            ) : (
              <div key={item.meta.key}>
                {/* One sentence per role: the badge and "Owner of" lead, then the
                    communities run inline after it, separated by & (or , for a
                    longer list). The panel is a deliberately narrow fixed width,
                    so a long list wraps onto as many lines as it needs; the badge
                    and its label are one non-wrapping unit so a wrap can never
                    strand "Owner of" on its own line. */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 py-1">
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <Image
                      alt=""
                      className="h-5 w-15 shrink-0 object-contain"
                      height={20}
                      src={item.meta.src}
                      unoptimized
                      width={60}
                    />
                    <span className="text-foreground text-xs font-semibold">
                      {item.meta.title} of
                    </span>
                  </span>
                  {item.communities.map((community, index) => (
                    <span
                      className="inline-flex items-center"
                      key={community.slug}
                    >
                      {index > 0 ? (
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground mr-1.5 text-xs"
                        >
                          {index === item.communities.length - 1 ? "&" : ","}
                        </span>
                      ) : null}
                      <Link
                        className="hover:bg-muted/60 flex items-center gap-1.5 rounded-lg py-0.5 pr-1.5 pl-0.5 transition-colors"
                        href={`/a/${community.slug}`}
                        onClick={() => setOpen(false)}
                      >
                        <CommunityAvatar
                          accentColor={community.accentColor}
                          avatarUrl={community.avatarUrl}
                          className="size-5 shrink-0"
                          name={community.name}
                          size={20}
                          slug={community.slug}
                        />
                        {/* Address only, no name: the mark plus a/slug is what
                            identifies a community everywhere else in the app
                            (cards, rails, members), and the name is redundant
                            next to it. */}
                        <span className="text-foreground text-xs font-medium">
                          a/{community.slug}
                        </span>
                      </Link>
                    </span>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export default memo(UserBadge);
