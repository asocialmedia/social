"use client";

import type { CommunityData } from "@asm/db";
import { motion } from "motion/react";
import type { MotionStyle } from "motion/react";
import Image from "next/image";
import { useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { communityAccentStyle } from "@/lib/communities/accent";
import type { CommunityRoleValue } from "@/lib/communities/client";
import { formatNumber } from "@/lib/utils";

import CommunityAvatar from "../card/community-avatar";
import JoinButton from "./join-button";
import CommunityNotifyButton from "./notify-button";

interface CommunityHeaderProps {
  avatarRef: (element: HTMLDivElement | null) => void;
  avatarStyle: MotionStyle;
  nameRef: (element: HTMLDivElement | null) => void;
  nameStyle: MotionStyle;
  slugRef: (element: HTMLDivElement | null) => void;
  slugStyle: MotionStyle;
  detailsStyle: MotionStyle;
  community: CommunityData;
  membership: {
    role: CommunityRoleValue;
    status: "ACTIVE" | "PENDING";
  } | null;
  members: number;
  // Whether the viewer follows this community's posts.
  subscribed: boolean;
}

// Community banner + identity row. The banner is masked into the surface so it
// dissolves instead of ending in a hard band; the accent is a single rail on
// the header, matching the post card.
export default function CommunityHeader({
  community,
  avatarRef,
  avatarStyle,
  nameRef,
  nameStyle,
  slugRef,
  slugStyle,
  detailsStyle,
  membership,
  members,
  subscribed,
}: CommunityHeaderProps) {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const [bannerFailed, setBannerFailed] = useState(false);

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
        {/* Identity elements stay above the navigation background during their
            transform, without a stacking context on the containing row. */}
        <div className="relative -mt-8 flex items-end justify-between gap-3 sm:-mt-10">
          <motion.div
            className="relative z-30 size-16 shrink-0 origin-top-left sm:size-20"
            ref={avatarRef}
            style={avatarStyle}
          >
            <CommunityAvatar
              accentColor={community.accentColor}
              avatarUrl={community.avatarUrl}
              className="size-16 sm:size-20"
              name={community.name}
              priority
              slug={community.slug}
            />
          </motion.div>
          {/* Two actions live here: Join, and the notify bell. Sharing moved to
              the browser's own affordance and posting lives on the persistent
              compose button, which scopes itself to this community.

              An owner cannot leave their own community, so the Join pill is
              dead weight for them - but the bell stays, because a subscribed
              owner is still notified when other members post. */}
          <motion.div
            className="pointer-events-auto flex flex-wrap items-center justify-end gap-2 pb-1"
            style={detailsStyle}
          >
            {membership?.role === "OWNER" ? null : (
              <JoinButton
                className="w-auto"
                communityId={community.id}
                initialMembership={membership}
                isLoggedIn={isLoggedIn}
                slug={community.slug}
              />
            )}
            <CommunityNotifyButton
              communityId={community.id}
              initialSubscribed={subscribed}
              isLoggedIn={isLoggedIn}
              slug={community.slug}
            />
          </motion.div>
        </div>

        <div className="mt-3">
          <motion.div
            className="relative z-30 origin-top-left text-xl font-bold sm:text-2xl"
            ref={nameRef}
            style={nameStyle}
          >
            <h1 className="text-foreground truncate">{community.name}</h1>
          </motion.div>
          <div className="text-muted-foreground flex items-center gap-1 text-sm">
            <motion.div
              className="relative z-30 min-w-0 origin-top-left truncate"
              ref={slugRef}
              style={slugStyle}
            >
              a/{community.slug}
            </motion.div>
            <motion.span className="shrink-0" style={detailsStyle}>
              · {formatNumber(members)} member{members === 1 ? "" : "s"}
            </motion.span>
          </div>
        </div>
      </div>
    </header>
  );
}
