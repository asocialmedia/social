"use client";

import type {
  CommunityData,
  CommunityStats,
  getCommunityPreview,
} from "@asm/db";
import {
  communityFeedSearchParams,
  readCommunityFeedSelection,
} from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import { useCommunityChatViewport } from "@/hooks/use-community-chat-viewport";
import { useCommunityNavigation } from "@/hooks/use-community-navigation";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { communityChatLocation } from "@/lib/communities/chat-navigation";
import type { CommunityRoleValue } from "@/lib/communities/client";
import { cn } from "@/lib/utils";
import { useActiveCommunityStore } from "@/store/active-community-store";
import {
  communitySectionScope,
  useCommunitySectionStore,
} from "@/store/community-section-store";

import CommunityChannelShortcuts from "./community-channel-shortcuts";
import CommunityChat from "./community-chat";
import CommunityMatureGate from "./community-mature-gate";
import CommunityPostsWorkspace from "./community-posts-workspace";
import CommunityPrivateLanding from "./community-private-landing";
import CommunitySidebar from "./community-sidebar";
import { CommunityWorkspacePortalContext } from "./community-workspace-context";
import CommunityWorkspaceNavigation from "./community-workspace-navigation";

interface ClientCommunityProps {
  viewerId?: string;
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  slug: string;
  stats: CommunityStats;
  view?: "chat" | "posts";
  channelId?: string;
  threadId?: string;
  // Whether the viewer follows this community's posts; drives the header bell.
  subscribed: boolean;
}

// Community page shell. The center column holds the header + feed; the right
// rail holds the about block. A mature community gates the whole page behind an
// 18+ interstitial before any content renders.
export default function ClientCommunity({
  community,
  membership,
  slug,
  stats,
  subscribed,
  view = "posts",
  channelId,
  threadId,
  viewerId,
}: ClientCommunityProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const privatePreview = useQuery({
    enabled: community.type === "PRIVATE",
    queryFn: async () => {
      const response = await fetch(`/api/communities/${slug}/preview`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Couldn't verify community access");
      }
      return response.json() as Promise<
        NonNullable<Awaited<ReturnType<typeof getCommunityPreview>>>
      >;
    },
    queryKey: ["community-preview", slug, user?.id ?? ""],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const lostPrivateAccess =
    community.type === "PRIVATE" &&
    (privatePreview.data?.permissions.canReadContent === false ||
      (user?.id ?? "") !== viewerId);
  useEffect(() => {
    if (lostPrivateAccess) {
      for (const queryKey of [
        ["community-feed", slug],
        ["post-feed"],
        ["post"],
        ["related-posts"],
        ["liked-posts"],
        ["post-author-posts"],
        ["post-history"],
        ["notifications"],
        ["community", slug],
        ["community-members", slug],
        ["community-chat", slug],
      ]) {
        queryClient.removeQueries({ queryKey });
      }
      router.refresh();
    }
  }, [lostPrivateAccess, queryClient, router, slug]);

  const sectionScope = communitySectionScope(user?.id, slug);
  const rememberSection = useCommunitySectionStore((state) => state.remember);
  useEffect(() => {
    if (view === "posts") {
      const filters = communityFeedSearchParams(
        readCommunityFeedSelection(searchParams)
      ).toString();
      rememberSection(sectionScope, {
        postsHref: `/a/${slug}${filters ? `?${filters}` : ""}`,
      });
    } else {
      const location = communityChatLocation(pathname, slug);
      if (location) {
        rememberSection(sectionScope, {
          chatHref: `/a/${slug}/chat/${location.channelId}`,
        });
      }
    }
  }, [pathname, rememberSection, searchParams, sectionScope, slug, view]);
  const navigation = useCommunityNavigation();
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const chatViewportRef = useCommunityChatViewport(view === "chat");
  const [workspaceElement, setWorkspaceElement] =
    useState<HTMLDivElement | null>(null);
  const attachWorkspace = useCallback(
    (element: HTMLDivElement | null) => {
      chatViewportRef.current = element;
      setWorkspaceElement(element);
    },
    [chatViewportRef]
  );
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
  const canPost =
    membership?.status === "ACTIVE" &&
    !lostPrivateAccess &&
    (community.type !== "PRIVATE" ||
      Boolean(
        privatePreview.data?.permissions.canReadContent &&
        !privatePreview.isError
      ));
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

  if (community.type === "PRIVATE" && privatePreview.isError) {
    return (
      <div role="alert" className="p-6 text-sm">
        <p>Couldn't verify community access.</p>
        <Button
          className="mt-3 min-h-11"
          variant="ghost"
          onClick={() => {
            void privatePreview.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (
    lostPrivateAccess ||
    (community.type === "PRIVATE" && !privatePreview.data)
  ) {
    if (privatePreview.data) {
      return (
        <CommunityPrivateLanding
          initialPreview={privatePreview.data}
          viewerId={user?.id ?? ""}
        />
      );
    }
    return (
      <output className="text-muted-foreground p-6 text-sm">
        Checking community access…
      </output>
    );
  }

  return (
    <CommunityWorkspacePortalContext.Provider value={workspaceElement}>
      {/* The community renders either way; when gated it is blurred and made
          inert so the gate reads as a popup over the real page rather than
          replacing it. `overflow-hidden` also clips the blur's soft bleed. */}
      <div
        ref={attachWorkspace}
        className={cn(
          "relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden",
          view === "chat" &&
            "fixed inset-x-0 top-[var(--community-chat-top,0px)] z-20 h-[var(--community-chat-height,100dvh)] md:relative md:inset-auto md:z-auto md:h-full"
        )}
      >
        <div
          aria-hidden={isBlocked || undefined}
          className={cn(
            "flex min-h-0 min-w-0 flex-1",
            isBlocked && "pointer-events-none scale-[1.03] blur-md select-none"
          )}
          inert={isBlocked || undefined}
        >
          {/* Same column metrics as the home feed: lg:max-w-5xl on the center
              column and a w-72 rail, so the two pages share one grid instead of
              the community reading narrower with a wider rail. */}
          {view === "posts" ? (
            <CommunityWorkspaceNavigation
              active="posts"
              accentColor={community.accentColor}
              avatarUrl={community.avatarUrl}
              communityName={community.name}
              desktop={navigation.desktop}
              navigation={
                communityChatUiEnabled && navigation.open ? (
                  <CommunityChannelShortcuts
                    slug={slug}
                    onNavigate={() => {
                      if (!navigation.desktop) {
                        navigation.setOpen(false);
                      }
                    }}
                  />
                ) : null
              }
              open={navigation.open}
              onOpenChange={(open) => navigation.setOpen(open)}
              slug={slug}
              triggerRef={navigationTriggerRef}
            />
          ) : null}
          <div
            className={cn(
              "border-border/60 mx-auto flex min-h-0 min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x",
              view === "posts" && "lg:max-w-5xl"
            )}
          >
            {view === "posts" ? <MobileTopBar /> : null}
            {view === "chat" ? (
              channelId && (
                <CommunityChat
                  key={threadId ?? channelId}
                  accentColor={community.accentColor}
                  avatarUrl={community.avatarUrl}
                  channelId={channelId}
                  communityId={community.id}
                  communityName={community.name}
                  membership={membership}
                  memberCount={stats.members}
                  canReviewRequests={
                    community.type !== "PUBLIC" &&
                    membership?.status === "ACTIVE" &&
                    (membership.role === "OWNER" ||
                      membership.role === "MODERATOR")
                  }
                  slug={slug}
                  threadId={threadId}
                />
              )
            ) : (
              <CommunityPostsWorkspace
                community={community}
                members={stats.members}
                membership={membership}
                subscribed={subscribed}
                navigationOpen={navigation.open}
                navigationModalOpen={navigation.open && !navigation.desktop}
                onOpenNavigation={() => navigation.setOpen(true)}
                navigationTriggerRef={navigationTriggerRef}
              />
            )}
          </div>

          {view === "posts" ? (
            <CommunitySidebar
              community={community}
              membership={membership}
              stats={stats}
            />
          ) : null}
        </div>

        {isBlocked ? (
          <CommunityMatureGate
            community={community}
            onEnter={handleEnter}
            onLeave={handleLeave}
          />
        ) : null}
        {view === "posts" ? <MobileBottomNav /> : null}
      </div>
    </CommunityWorkspacePortalContext.Provider>
  );
}
