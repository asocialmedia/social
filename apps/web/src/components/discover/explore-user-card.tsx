"use client";

import type { UserData } from "@asm/db";
import { Flame, MessageSquare, Users } from "lucide-react";
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
    <div className="sidebar-subcard flex flex-col gap-3 rounded-2xl p-4">
      <Link
        className="flex items-center gap-3"
        href={`/users/${user.username}`}
      >
        <UserAvatar avatarUrl={user.avatarUrl} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold hover:underline">
            {user.displayName}
          </p>
          <p className="truncate text-muted-foreground text-sm">
            @{user.username}
          </p>
        </div>
      </Link>

      {user.bio ? (
        <p className="line-clamp-2 text-muted-foreground text-sm">{user.bio}</p>
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
  );
};

export default ExploreUserCard;
