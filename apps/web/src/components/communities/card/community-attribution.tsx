"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { getShortPostId } from "@/lib/seo/seo";
import { cn } from "@/lib/utils";

import CommunityAvatar from "./community-avatar";

export interface CommunityIdentity {
  accentColor: string;
  avatarUrl?: string | null;
  id: string;
  name: string;
  slug: string;
}

// The compact community identity shown on a post card. Native community posts
// carry it in the header; a reshare carries it on the source card. The accent
// is a tonal key resolved to a theme-aware CSS variable, so the same mark stays
// legible in light and dark without hardcoded colors.
export const CommunityAttribution = ({
  className,
  community,
  reason,
}: {
  className?: string;
  community: CommunityIdentity;
  // Optional ranked-feed reason ("Trending in a/anime"). Only shown when the
  // post is surfaced by a recommendation feed.
  reason?: string;
}) => (
  <div className={cn("flex min-w-0 items-center gap-2", className)}>
    <CommunityAvatar
      {...community}
      avatarUrl={
        community.avatarUrl ??
        `/api/communities/avatar/${encodeURIComponent(community.id)}/image`
      }
      className="size-5.5! rounded-md!"
      size={22}
    />
    <Link
      className="text-muted-foreground hover:text-foreground min-w-0 truncate text-xs font-medium transition-colors"
      href={`/a/${community.slug}`}
    >
      <span className="font-normal">Shared via </span>
      a/{community.slug}
    </Link>
    {reason ? (
      <>
        <span aria-hidden="true" className="text-muted-foreground/40 text-xs">
          ·
        </span>
        <span className="text-muted-foreground/80 truncate text-xs">
          {reason}
        </span>
      </>
    ) : null}
  </div>
);

// Reshare source card: a community post republished onto the global feed. The
// reshare owns its own media; this card only attributes the source, mirroring
// the HN story card's role.
export const CommunityShareCard = ({
  community,
  sourcePostId,
}: {
  community: CommunityIdentity;
  sourcePostId: string;
}) => {
  // The source was published into `community`, so it lives under that
  // community's namespace. Only the id is stored on the share, so the content
  // slug is omitted here; the route adds it as a canonical redirect.
  const sourceHref = `/a/${community.slug}/posts/${getShortPostId(sourcePostId)}`;
  return (
    <Link
      className="border-border/60 hover:bg-muted/40 group mt-3 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors"
      href={sourceHref}
    >
      <CommunityAvatar
        {...community}
        avatarUrl={
          community.avatarUrl ??
          `/api/communities/avatar/${encodeURIComponent(community.id)}/image`
        }
        className="size-8! rounded-lg!"
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {community.name}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          Shared via a/{community.slug}
        </span>
      </span>
      <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
    </Link>
  );
};
