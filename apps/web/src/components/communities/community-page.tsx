"use client";

import type { CommunityData, CommunityStats, UserData } from "@asm/db";
import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import { communityAccentStyle } from "@/lib/communities/accent";

import CommunityAbout from "./community-about";
import CommunityFeed from "./community-feed";
import CommunityHeader from "./community-header";

interface ClientCommunityProps {
  community: CommunityData;
  membership: {
    role: "MEMBER" | "MODERATOR" | "OWNER";
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

  if (community.mature && !matureAccepted) {
    return (
      <div
        className="mx-auto flex max-w-2xl min-w-0 flex-1 items-center justify-center px-5"
        style={communityAccentStyle(community.accentColor)}
      >
        <div className="border-border/60 w-full max-w-md rounded-2xl border p-6 text-center">
          <ShieldAlert className="mx-auto size-7 text-[var(--community-accent)] dark:text-[var(--community-accent-dark)]" />
          <h1 className="text-foreground mt-4 text-lg font-bold">
            a/{community.slug} is marked 18+
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            This community may contain mature content. You must be over 18 to
            view and contribute.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              className="border-border/60 hover:bg-muted/50 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              onClick={handleLeave}
              type="button"
            >
              Go back
            </button>
            <button
              className="bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium"
              onClick={handleEnter}
              type="button"
            >
              I am 18 or older
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-3xl">
        <MobileTopBar />
        <CommunityHeader
          community={community}
          members={stats.members}
          membership={membership}
        />
        <CommunityFeed slug={slug} />
      </div>

      <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-80 shrink-0 flex-col overflow-visible border-l px-3 pt-3 pb-6 xl:flex">
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

      <MobileBottomNav />
    </>
  );
}
