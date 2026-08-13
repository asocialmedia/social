"use client";

import type { UserData } from "@asm/db";
import { Flame, MessageSquare, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
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

  let headerContent: React.ReactNode;
  if (user.bannerUrl) {
    headerContent = (
      <Image
        alt=""
        className="object-cover"
        fill
        sizes="280px"
        src={getSecureImageUrl(user.bannerUrl)}
        unoptimized
      />
    );
  } else if (avatarUrl) {
    headerContent = (
      <div
        aria-hidden
        className="absolute inset-0 bg-center bg-cover"
        style={{
          backgroundImage: `url(${avatarUrl})`,
          filter: "blur(10px) brightness(0.75)",
          transform: "scale(1.15)",
        }}
      />
    );
  } else {
    headerContent = (
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/40 to-orange-600/20" />
    );
  }

  return (
    <div className="sidebar-subcard flex h-full flex-col overflow-hidden rounded-2xl">
      <Link
        className="relative block h-20 w-full shrink-0 overflow-hidden"
        href={`/users/${user.username}`}
      >
        {headerContent}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="-mt-8 flex items-end gap-3">
          <Link className="shrink-0" href={`/users/${user.username}`}>
            <UserAvatar
              avatarUrl={user.avatarUrl}
              className="rounded-xl ring-4 ring-[hsl(var(--background-alt))]"
              size={48}
            />
          </Link>
        </div>

        <div className="min-w-0">
          <Link
            className="block truncate font-semibold hover:underline"
            href={`/users/${user.username}`}
          >
            {user.displayName}
          </Link>
          <p className="truncate text-muted-foreground text-sm">
            @{user.username}
          </p>
        </div>

        {user.bio ? (
          <p className="line-clamp-2 text-muted-foreground text-sm">
            {user.bio}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">
              {formatNumber(followers)}
            </span>{" "}
            followers
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">
              {formatNumber(user._count.posts)}
            </span>{" "}
            posts
          </span>
          <span className="flex items-center gap-1">
            <Flame className="h-3.5 w-3.5 text-orange-500" />
            <span className="font-medium text-foreground">
              {formatNumber(user.aura)}
            </span>{" "}
            aura
          </span>
        </div>

        <FollowButton
          className={cn("follow-btn-3d mt-auto h-8 w-full px-3 text-xs")}
          initialState={{ followers, isFollowedByUser: isFollowed }}
          onFollowed={handleFollowed}
          userId={user.id}
        />
      </div>
    </div>
  );
};

export default ExploreUserCard;
