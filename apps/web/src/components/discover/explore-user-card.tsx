"use client";

import type { UserData } from "@asm/db";
import { Flame, Users } from "lucide-react";
import Link from "next/link";
import type React from "react";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import { useFollowStates } from "@/hooks/use-follow-states";
import { cn, formatNumber } from "@/lib/utils";

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

  return (
    <div className="sidebar-subcard group mb-4 break-inside-avoid rounded-2xl p-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
      <Link
        className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1.5"
        href={`/users/${user.username}`}
      >
        <UserAvatar avatarUrl={user.avatarUrl} className="h-10 w-10" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">
            {user.displayName}
          </span>
          <span className="block truncate text-muted-foreground text-xs">
            @{user.username}
          </span>
        </span>
      </Link>

      {user.bio ? (
        <p className="mt-1 line-clamp-2 px-1 text-muted-foreground text-sm">
          {user.bio}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3 px-1 text-muted-foreground text-xs">
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">
            {formatNumber(followers)}
          </span>{" "}
          followers
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
        className={cn("follow-btn-3d mt-3 h-8 w-full px-3 text-xs")}
        initialState={{ followers, isFollowedByUser: isFollowed }}
        onFollowed={handleFollowed}
        userId={user.id}
      />
    </div>
  );
};

export default ExploreUserCard;
