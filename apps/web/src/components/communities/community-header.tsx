"use client";

import type { CommunityData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { PenSquare, Share2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { communityAccentStyle } from "@/lib/communities/accent";
import type { CommunityRoleValue } from "@/lib/communities/client";
import { useToast } from "@/lib/gooey-toast";
import { formatNumber } from "@/lib/utils";
import { useComposerStore } from "@/store/composer-store";

import CommunityAvatar from "./community-avatar";
import JoinButton from "./join-button";

interface CommunityHeaderProps {
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  members: number;
}

// Community banner + identity row. The banner is masked into the surface so it
// dissolves instead of ending in a hard band; the accent is a single rail on
// the header, matching the post card.
export default function CommunityHeader({
  community,
  membership,
  members,
}: CommunityHeaderProps) {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const openComposerInCommunity = useComposerStore(
    (state) => state.openComposerInCommunity
  );
  const [bannerFailed, setBannerFailed] = useState(false);

  const canPost = membership?.status === "ACTIVE";

  const handleCreatePost = useCallback(() => {
    openComposerInCommunity({
      accentColor: community.accentColor,
      id: community.id,
      name: community.name,
      slug: community.slug,
    });
  }, [community, openComposerInCommunity]);

  const { toast } = useToast();

  const handleShare = useCallback(async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `a/${community.slug} on asocialmedia`,
          url,
        });
        return;
      } catch {
        // The user dismissed the sheet; fall through to copy.
      }
    }
    // Desktop without the Web Share API: copy the link instead of a dead click.
    try {
      await navigator.clipboard.writeText(url);
      toast({ description: "Link copied", title: "Copied" });
    } catch {
      toast({
        description: "Couldn't copy the link",
        variant: "destructive",
      });
    }
  }, [community.slug, toast]);

  const hasBanner = Boolean(community.bannerUrl) && !bannerFailed;

  return (
    <header
      className="relative"
      style={communityAccentStyle(community.accentColor)}
    >
      <div className="relative h-36 overflow-hidden sm:h-48">
        {hasBanner ? (
          <Image
            alt={`${community.name} banner`}
            className="object-cover"
            fill
            onError={() => setBannerFailed(true)}
            sizes="(max-width: 768px) 100vw, 1024px"
            src={community.bannerUrl as string}
            unoptimized
          />
        ) : (
          // No upload yet: a tonal wash off the community accent, so the header
          // still carries the community's identity instead of a flat gray band.
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--community-accent) 22%, hsl(var(--muted))), hsl(var(--muted)))",
            }}
          />
        )}
        {/* Fade the banner into the page surface so the image never ends in a
            hard horizontal band where the content column begins. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-b from-transparent to-[hsl(var(--background-alt))]"
        />
      </div>

      <div className="px-4 pb-4">
        {/* relative z-10 is load-bearing: the banner above is position:relative,
            so it paints on top of a static sibling and was cropping the top of
            the avatar as it pulled up over the banner. Positioned + z-10 puts
            the identity row back in front of the artwork. */}
        <div className="relative z-10 -mt-8 flex items-end justify-between gap-3 sm:-mt-10">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-16 sm:size-20"
            name={community.name}
            priority
            slug={community.slug}
          />
          <div className="flex flex-wrap items-center justify-end gap-2 pb-1">
            <Button
              aria-label="Share community"
              className="icon-btn-3d flex h-8 w-8 items-center justify-center rounded-full p-0!"
              onClick={handleShare}
              variant="ghost"
            >
              <Share2 className="size-4" />
            </Button>
            {/* An owner cannot leave their own community, so a "Join/Owner" pill
                is dead weight next to Create post. Ownership is already stated
                in the About panel and the members list. */}
            {membership?.role === "OWNER" ? null : (
              <JoinButton
                className="w-auto"
                communityId={community.id}
                initialMembership={membership}
                isLoggedIn={isLoggedIn}
                slug={community.slug}
              />
            )}
            <Button
              className="h-8 gap-1.5 px-3.5! py-0! text-xs!"
              disabled={!canPost}
              onClick={handleCreatePost}
              title={canPost ? undefined : "Join this community to post in it"}
              variant="premium"
            >
              <PenSquare className="size-4" />
              Create post
            </Button>
          </div>
        </div>

        <div className="mt-3">
          <h1 className="text-foreground text-xl font-bold sm:text-2xl">
            {community.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            a/{community.slug} · {formatNumber(members)} member
            {members === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </header>
  );
}
