"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { communityAccentStyle } from "@/lib/communities/accent";
import { cn } from "@/lib/utils";

export interface CommunityIdentity {
  accentColor: string;
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
    <span
      aria-hidden="true"
      className="h-3.5 w-0.5 shrink-0 rounded-full bg-[var(--community-accent)] dark:bg-[var(--community-accent-dark)]"
      style={communityAccentStyle(community.accentColor)}
    />
    <Link
      className="text-muted-foreground hover:text-foreground min-w-0 truncate text-xs font-medium transition-colors"
      href={`/a/${community.slug}`}
    >
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
}) => (
  <Link
    className="border-border/60 hover:bg-muted/40 group mt-3 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors"
    href={`/posts/${sourcePostId}`}
  >
    <span
      aria-hidden="true"
      className="h-8 w-0.5 shrink-0 rounded-full bg-[var(--community-accent)] dark:bg-[var(--community-accent-dark)]"
      style={communityAccentStyle(community.accentColor)}
    />
    <span className="min-w-0 flex-1">
      <span className="text-foreground block truncate text-sm font-medium">
        {community.name}
      </span>
      <span className="text-muted-foreground block truncate text-xs">
        Shared from a/{community.slug}
      </span>
    </span>
    <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
  </Link>
);
