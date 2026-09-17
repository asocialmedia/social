"use client";

import type { CommunityData, CommunityStats, UserData } from "@asm/db";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import type { CommunityRoleValue } from "@/lib/communities/client";
import { cn } from "@/lib/utils";

import CommunityAbout from "./community-about";
import CommunityFeed from "./community-feed";
import CommunityHeader from "./community-header";
import CommunityMatureGate from "./community-mature-gate";

interface ClientCommunityProps {
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  owner: Pick<UserData, "avatarUrl" | "displayName" | "id" | "username"> | null;
  slug: string;
  stats: CommunityStats;
}

// Community page shell. The center column holds the header + feed; the right
// rail holds the about block. A mature community gates the whole page behind an
// 18+ interstitial before any content renders.
export default function ClientCommunity({
  community,
  membership,
  owner,
  slug,
  stats,
}: ClientCommunityProps) {
  const router = useRouter();
  const [matureAccepted, setMatureAccepted] = useState(false);
  const hasRecorded = useRef(false);

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

          <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-visible border-l px-2.5 pt-2.5 pb-5 xl:flex">
            <div className="shrink-0 pb-3">
              <SearchField />
            </div>
            <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto">
              <CommunityAbout
                community={community}
                membership={membership}
                owner={owner}
                stats={stats}
              />
            </div>
          </aside>
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
