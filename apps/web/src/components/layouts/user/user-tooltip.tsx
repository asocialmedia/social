"use client";

import type { FollowerInfo, UserData } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { formatDate } from "date-fns";
import { Flame, UserPlus, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import type { PropsWithChildren } from "react";
import { useState, useSyncExternalStore } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { PostInlineContent } from "@/components/posts/content/post-inline-content";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { cn, formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import FollowButton from "./follow-button";
import UserAvatar from "./user-avatar";
import UserBadge from "./user-badge";

interface UserTooltipProps extends PropsWithChildren {
  user: UserData;
}

// Viewport detection as an external store: the server snapshot renders the
// tooltip variant so hydration matches, then the client snapshot flips to the
// compact children on small screens. Resize events drive re-reads, replacing
// the old setState-in-effect cascade.
// oxlint-disable-next-line promise/prefer-await-to-callbacks -- useSyncExternalStore subscribe contract requires a callback API
function subscribeToViewport(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => {
    window.removeEventListener("resize", callback);
  };
}

const getIsMobileSnapshot = () => window.innerWidth < 768;

const getServerIsMobile = () => false;

const TooltipStat = ({
  icon: Icon,
  iconClassName,
  label,
  value,
  filled = true,
}: {
  icon: React.ComponentType<{ className?: string; fill?: string }>;
  iconClassName?: string;
  label: string;
  value: number;
  filled?: boolean;
}) => (
  <span className="text-card-foreground inline-flex w-full min-w-0 items-center justify-center gap-1.5 text-sm font-semibold">
    <Icon
      className={cn(
        "size-4 shrink-0",
        iconClassName ?? "text-muted-foreground"
      )}
      fill={filled ? "currentColor" : undefined}
    />
    <span className="tabular-nums">{formatNumber(value)}</span>
    <span className="sr-only">{label}</span>
  </span>
);

export default function UserTooltip({ children, user }: UserTooltipProps) {
  const { user: loggedInUser } = useSession();
  const [bannerFailed, setBannerFailed] = useState(false);
  const isMobile = useSyncExternalStore(
    subscribeToViewport,
    getIsMobileSnapshot,
    getServerIsMobile
  );

  if (!user || isMobile) {
    return children;
  }

  const followerState: FollowerInfo = {
    followers: user._count?.followers ?? 0,
    isFollowedByUser: user.followers
      ? !!user.followers.some(
          ({ followerId }) => followerId === loggedInUser?.id
        )
      : false,
  };

  const canFollow = Boolean(loggedInUser && loggedInUser.id !== user.id);
  const aura = user.aura ?? 0;
  const bannerUrl =
    user.bannerUrl && !bannerFailed ? getSecureImageUrl(user.bannerUrl) : null;

  // Header image pinned to the top-left corner the way the "Who to follow"
  // rows pin theirs: the panel colour sweeps in from the right and up from the
  // bottom, so the visible photograph stays anchored to the top-left corner.
  let headerImage: React.ReactNode;
  if (bannerUrl) {
    headerImage = (
      <Image
        alt=""
        className="object-cover"
        fill
        onError={() => setBannerFailed(true)}
        sizes="320px"
        src={bannerUrl}
        unoptimized
      />
    );
  } else if (user.avatarUrl) {
    headerImage = (
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-40 blur-md"
        style={{ backgroundImage: `url(${getSecureImageUrl(user.avatarUrl)})` }}
      />
    );
  } else {
    headerImage = (
      <div className="absolute inset-0 bg-gradient-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-90" />
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="overflow-hidden p-0" sideOffset={6}>
          <div className="flex max-w-80 flex-col wrap-break-word md:min-w-56">
            <div className="relative h-20 shrink-0 overflow-hidden">
              {headerImage}
              <div className="absolute inset-0 bg-linear-to-l from-[hsl(var(--background-alt))] via-[hsl(var(--background-alt)/0.72)] to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background-alt))] via-[hsl(var(--background-alt)/0.35)] to-transparent" />
            </div>

            <div className="relative flex flex-col gap-2.5 px-3 pb-3">
              <div className="-mt-8 flex items-end justify-between gap-3">
                <Link className="shrink-0" href={`/users/${user.username}`}>
                  {/* The separation from the banner is a painted wrapper, not a
                      `ring-*`: .avatar-ring sets box-shadow unlayered in
                      globals.css, so a ring utility is silently discarded. */}
                  <span className="inline-flex rounded-xl bg-[hsl(var(--background-alt))] p-1">
                    <UserAvatar avatarUrl={user.avatarUrl} size={56} />
                  </span>
                </Link>
                {canFollow ? (
                  <FollowButton
                    className="mb-1 h-8 shrink-0 px-3 text-xs"
                    initialState={followerState}
                    userId={user.id}
                  />
                ) : null}
              </div>

              <Link
                className="flex min-w-0 flex-col gap-0.5"
                href={`/users/${user.username}`}
              >
                <span className="text-card-foreground flex items-center gap-1.5 text-base leading-tight font-semibold">
                  <span className="truncate">
                    {user.displayName || user.username}
                  </span>
                  <UserBadge
                    badge={user.badge}
                    badges={user.badges}
                    communityRoles={user.communityMemberships}
                  />
                </span>
                <span className="text-muted-foreground block truncate text-sm">
                  @{user.username}
                </span>
              </Link>

              <span className="text-muted-foreground text-xs">
                Joined {formatDate(new Date(user.createdAt), "MMM yyyy")}
              </span>

              {user.bio ? (
                // PostInlineContent, not raw LinkIt: it renders @mentions and
                // #hashtags as the same avatar/tag chips the feed and profile
                // use, and URLs as link badges. Raw LinkIt produced plain
                // underlined text, so the tooltip's bio read as a plainer
                // surface than every other place a bio appears.
                //
                // Deliberately the tooltip-free renderer: these mentions must
                // not open their own hover card from inside a tooltip.
                <PostInlineContent
                  className="text-card-foreground line-clamp-4 text-sm whitespace-pre-line"
                  content={user.bio}
                  linkBadge="chip"
                />
              ) : null}

              <div className="grid grid-cols-3 items-center gap-3">
                <TooltipStat
                  icon={Users}
                  label="Followers"
                  value={followerState.followers}
                />
                <TooltipStat
                  icon={UserPlus}
                  label="Following"
                  value={user._count?.following ?? 0}
                />
                <TooltipStat
                  filled={false}
                  icon={Flame}
                  iconClassName={getAuraFlameClass(aura)}
                  label="Aura"
                  value={aura}
                />
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
