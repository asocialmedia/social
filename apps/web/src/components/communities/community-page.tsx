"use client";

import type { CommunityData, CommunityStats } from "@asm/db";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import type { CommunityRoleValue } from "@/lib/communities/client";
import { cn } from "@/lib/utils";
import { useActiveCommunityStore } from "@/store/active-community-store";

import CommunityFeed from "./community-feed";
import CommunityHeader from "./community-header";
import CommunityMatureGate from "./community-mature-gate";
import CommunitySidebar from "./community-sidebar";

interface ClientCommunityProps {
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  slug: string;
  stats: CommunityStats;
}

// Community page shell. The center column holds the header + feed; the right
// rail holds the about block. A mature community gates the whole page behind an
// 18+ interstitial before any content renders.
export default function ClientCommunity({
  community,
  membership,
  slug,
  stats,
}: ClientCommunityProps) {
  const router = useRouter();
  const [matureAccepted, setMatureAccepted] = useState(false);
  const hasRecorded = useRef(false);
  const setActiveCommunity = useActiveCommunityStore(
    (state) => state.setActiveCommunity
  );
  const clearActiveCommunity = useActiveCommunityStore(
    (state) => state.clearActiveCommunity
  );

  // Publish this community as the page context while it is mounted, so the
  // persistent compose triggers (left sidebar, mobile dock) open scoped to it.
  // Cleared on unmount so leaving the page returns them to the global composer.
  //
  // `canPost` mirrors the header's own gate: only an ACTIVE member may publish
  // into the community, and anything else must fall back to the global composer.
  const canPost = membership?.status === "ACTIVE";
  useEffect(() => {
    setActiveCommunity(
      {
        accentColor: community.accentColor,
        avatarUrl: community.avatarUrl,
        id: community.id,
        name: community.name,
        slug: community.slug,
      },
      canPost
    );
    return () => clearActiveCommunity();
  }, [
    canPost,
    clearActiveCommunity,
    community.accentColor,
    community.avatarUrl,
    community.id,
    community.name,
    community.slug,
    setActiveCommunity,
  ]);

  // One visit row per (community, viewer) per page mount. Best effort: a
  // failure never blocks the page.
  useEffect(() => {
    if (hasRecorded.current) {
      return;
    }
    hasRecorded.current = true;
    const recordVisit = async () => {
      try {
        await fetch(`/api/communities/${slug}/visit`, { method: "POST" });
      } catch {
        // Best effort: a failed visit record only affects the weekly count.
      }
    };
    void recordVisit();
  }, [slug]);

  const handleEnter = useCallback(() => {
    setMatureAccepted(true);
  }, []);

  const handleLeave = useCallback(() => {
    router.back();
  }, [router]);

  const isBlocked = community.mature && !matureAccepted;

  return (
    <>
      {/* The community renders either way; when gated it is blurred and made
          inert so the gate reads as a popup over the real page rather than
          replacing it. `overflow-hidden` also clips the blur's soft bleed. */}
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <div
          aria-hidden={isBlocked || undefined}
          className={cn(
            "flex min-w-0 flex-1",
            isBlocked && "pointer-events-none scale-[1.03] blur-md select-none"
          )}
          inert={isBlocked || undefined}
        >
          {/* Same column metrics as the home feed: lg:max-w-5xl on the center
              column and a w-72 rail, so the two pages share one grid instead of
              the community reading narrower with a wider rail. */}
          <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
            <MobileTopBar />
            <CommunityHeader
              community={community}
              members={stats.members}
              membership={membership}
            />
            <CommunityFeed slug={slug} />
          </div>

          <CommunitySidebar
            community={community}
            membership={membership}
            stats={stats}
          />
        </div>

        {isBlocked ? (
          <CommunityMatureGate
            community={community}
            onEnter={handleEnter}
            onLeave={handleLeave}
          />
        ) : null}
      </div>

      <MobileBottomNav />
    </>
  );
}
