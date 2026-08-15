"use client";

import type { UserData } from "@asm/db";
import { Flame, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import { useFollowStates } from "@/hooks/use-follow-states";
import { cn, formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

export interface ExploreUser extends UserData {
  followState?: {
    followers: number;
    isFollowedByUser: boolean;
  };
}

interface ExploreUserCardProps {
  onFollowed?: (userId: string) => void;
  user: ExploreUser;
}

const ExploreUserCard: React.FC<ExploreUserCardProps> = ({
  onFollowed,
  user,
}) => {
  const { data: followStates } = useFollowStates([user.id]);
  const followState = user.followState ?? followStates?.[user.id];
  const followers = followState?.followers ?? user._count.followers;
  const isFollowed = followState?.isFollowedByUser ?? false;

  const handleFollowed = () => onFollowed?.(user.id);
  const avatarUrl = user.avatarUrl ? getSecureImageUrl(user.avatarUrl) : null;
  const hasBanner = Boolean(user.bannerUrl);

  let headerMedia: React.ReactNode;
  if (user.bannerUrl) {
    headerMedia = (
      <Image
        alt=""
        className="object-cover transition-transform duration-300 group-hover:scale-105"
        fill
        sizes="280px"
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

  return (
    <div className="sidebar-subcard group mb-4 break-inside-avoid overflow-hidden rounded-2xl transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
      <Link
        aria-label={`View ${user.displayName || user.username}'s profile`}
        className="relative block h-24 w-full overflow-hidden"
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

      <div className="p-3">
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
            <UserBadge badge={user.badge} />
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
              className={cn(
                "h-3.5 w-3.5",
                user.aura < 0 ? "text-[#7c5cff]" : "text-orange-500"
              )}
            />
            <span className="text-foreground font-medium">
              {formatNumber(user.aura)}
            </span>{" "}
            aura
          </span>
        </div>

        <FollowButton
          className={cn("mt-3 h-8 w-full px-3 text-xs")}
          initialState={{ followers, isFollowedByUser: isFollowed }}
          onFollowed={handleFollowed}
          userId={user.id}
        />
      </div>
    </div>
  );
};

export default ExploreUserCard;
