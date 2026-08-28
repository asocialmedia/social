"use client";

import type { UserData } from "@asm/db";
import { Flame, Sparkles, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

import UserReasonLine from "@/components/discover/user-reason-line";
import type { UserMutualFollower } from "@/components/discover/user-reason-line";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import { useFollowStates } from "@/hooks/use-follow-states";
import { getAuraFlameClass } from "@/lib/aura";
import { cn, formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

export interface ExploreUser extends UserData {
  followState?: {
    followers: number;
    isFollowedByUser: boolean;
  };
  mutualFollowers?: UserMutualFollower[];
  // The suggested-users endpoint ranks reasons as an array; trending users
  // carry none. Rendered as a single line (first reason wins).
  reason?: string;
  reasons?: string[];
}

interface ExploreUserCardProps {
  // "featured" renders the full-width recommended layout at the top of the
  // People tab; the default compact card fills the discovery grid.
  variant?: "compact" | "featured";
  mutualFollowers?: UserMutualFollower[];
  onFollowed?: (userId: string) => void;
  reason?: string;
  user: ExploreUser;
}

function firstReason(
  user: { reason?: string; reasons?: string[] },
  propReason?: string
) {
  return propReason ?? user.reason ?? user.reasons?.[0];
}

const ExploreUserCard: React.FC<ExploreUserCardProps> = ({
  mutualFollowers,
  onFollowed,
  reason,
  user,
  variant = "compact",
}) => {
  const resolvedReason = firstReason(user, reason);
  const { data: followStates } = useFollowStates([user.id]);
  const followState = user.followState ?? followStates?.[user.id];
  const followers = followState?.followers ?? user._count.followers;
  const isFollowed = followState?.isFollowedByUser ?? false;

  const [bannerFailed, setBannerFailed] = useState(false);

  const handleFollowed = () => onFollowed?.(user.id);
  const avatarUrl = user.avatarUrl ? getSecureImageUrl(user.avatarUrl) : null;
  const hasBanner = Boolean(user.bannerUrl) && !bannerFailed;

  let headerMedia: React.ReactNode;
  if (user.bannerUrl && !bannerFailed) {
    headerMedia = (
      <Image
        alt=""
        className="object-cover transition-transform duration-300 group-hover:scale-105"
        fill
        onError={() => setBannerFailed(true)}
        sizes={
          variant === "featured" ? "(max-width: 640px) 100vw, 800px" : "280px"
        }
        src={getSecureImageUrl(user.bannerUrl)}
        unoptimized
      />
    );
  } else if (avatarUrl) {
    headerMedia = (
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
        style={{
          backgroundImage: `url(${avatarUrl})`,
          filter: "blur(10px) brightness(0.75)",
          transform: "scale(1.15)",
        }}
      />
    );
  } else {
    headerMedia = (
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/40 to-orange-600/20" />
    );
  }

  // ── Featured layout: the tab's single recommended card ──────────────────
  if (variant === "featured") {
    return (
      <div className="sidebar-subcard group mb-4 overflow-hidden rounded-2xl">
        <Link
          aria-label={`View ${user.displayName || user.username}'s profile`}
          className="bg-muted/20 relative block h-28 w-full overflow-hidden sm:h-32"
          href={`/users/${user.username}`}
        >
          {headerMedia}
          {hasBanner ? (
            <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--primary)/0.45)] via-[hsl(var(--primary)/0.15)] to-[hsl(var(--background-alt))]" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background-alt))] via-transparent to-transparent" />
          )}
          <span className="bg-primary/10 text-primary border-primary/20 absolute top-3 left-3 flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
            <Sparkles className="h-3 w-3 fill-current" />
            Recommended
          </span>
        </Link>

        <div className="p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="relative z-10 -mt-12 flex min-w-0 items-end gap-3">
              <Link
                aria-label={`View ${user.displayName || user.username}'s profile`}
                className="shrink-0"
                href={`/users/${user.username}`}
              >
                <UserAvatar
                  avatarUrl={user.avatarUrl}
                  className="rounded-2xl ring-4 ring-[hsl(var(--background-alt))]"
                  size={72}
                  user={user}
                />
              </Link>
              <div className="min-w-0 pb-1">
                <div className="flex items-center gap-1">
                  <Link
                    className="truncate font-semibold hover:underline"
                    href={`/users/${user.username}`}
                  >
                    {user.displayName}
                  </Link>
                  <UserBadge badge={user.badge} badges={user.badges} />
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  @{user.username}
                </p>
              </div>
            </div>
            <FollowButton
              className="mb-1 hidden h-9 shrink-0 px-4 text-xs sm:flex"
              initialState={{ followers, isFollowedByUser: isFollowed }}
              onFollowed={handleFollowed}
              userId={user.id}
            />
          </div>

          {user.bio ? (
            <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">
              {user.bio}
            </p>
          ) : null}

          {resolvedReason ? (
            <UserReasonLine
              mutualFollowers={mutualFollowers}
              reason={resolvedReason}
            />
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                <span className="text-foreground font-medium">
                  {formatNumber(followers)}
                </span>{" "}
                followers
              </span>
              <span className="flex items-center gap-1">
                <Flame
                  className={cn("h-3.5 w-3.5", getAuraFlameClass(user.aura))}
                />
                <span className="text-foreground font-medium">
                  {formatNumber(user.aura)}
                </span>{" "}
                aura
              </span>
            </div>
            <FollowButton
              className="h-8 w-full px-3 text-xs sm:hidden"
              initialState={{ followers, isFollowedByUser: isFollowed }}
              onFollowed={handleFollowed}
              userId={user.id}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Compact layout: discovery grid card ─────────────────────────────────
  return (
    <div className="sidebar-subcard group mb-4 flex h-full break-inside-avoid flex-col overflow-hidden rounded-2xl transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
      <Link
        aria-label={`View ${user.displayName || user.username}'s profile`}
        className="bg-muted/20 relative block h-24 w-full overflow-hidden"
        href={`/users/${user.username}`}
      >
        {headerMedia}
        {hasBanner ? (
          <div className="absolute inset-0 bg-gradient-to-b from-[hsl(var(--primary)/0.45)] via-[hsl(var(--primary)/0.15)] to-[hsl(var(--background-alt))]" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background-alt))] to-transparent" />
        )}
        <div className="bg-border/40 absolute inset-x-0 bottom-0 h-px" />
      </Link>

      <div className="flex flex-1 flex-col p-3">
        <div className="relative z-10 -mt-10 flex items-end justify-between">
          <Link
            aria-label={`View ${user.displayName || user.username}'s profile`}
            className="shrink-0"
            href={`/users/${user.username}`}
          >
            <UserAvatar
              avatarUrl={user.avatarUrl}
              className="rounded-2xl ring-4 ring-[hsl(var(--background-alt))]"
              size={64}
              user={user}
            />
          </Link>
        </div>

        <div className="mt-2 min-w-0">
          <div className="flex items-center gap-1">
            <Link
              className="block truncate font-semibold hover:underline"
              href={`/users/${user.username}`}
            >
              {user.displayName}
            </Link>
            <UserBadge badge={user.badge} badges={user.badges} />
          </div>
          <p className="text-muted-foreground truncate text-xs">
            @{user.username}
          </p>
        </div>

        {user.bio ? (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
            {user.bio}
          </p>
        ) : null}

        {resolvedReason ? (
          <UserReasonLine
            mutualFollowers={mutualFollowers}
            reason={resolvedReason}
          />
        ) : null}

        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium">
              {formatNumber(followers)}
            </span>{" "}
            followers
          </span>
          <span className="flex items-center gap-1">
            <Flame
              className={cn("h-3.5 w-3.5", getAuraFlameClass(user.aura))}
            />
            <span className="text-foreground font-medium">
              {formatNumber(user.aura)}
            </span>{" "}
            aura
          </span>
        </div>

        <div className="mt-auto pt-3">
          <FollowButton
            className="h-8 w-full px-3 text-xs"
            initialState={{ followers, isFollowedByUser: isFollowed }}
            onFollowed={handleFollowed}
            userId={user.id}
          />
        </div>
      </div>
    </div>
  );
};

export default ExploreUserCard;
