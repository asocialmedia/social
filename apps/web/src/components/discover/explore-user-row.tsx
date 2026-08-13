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

interface ExploreUserRowProps {
  onFollowed?: (userId: string) => void;
  user: ExploreUser;
}

const ExploreUserRow: React.FC<ExploreUserRowProps> = ({
  onFollowed,
  user,
}) => {
  const { data: followStates } = useFollowStates([user.id]);
  const followState = user.followState ?? followStates?.[user.id];
  const followers = followState?.followers ?? user._count.followers;
  const isFollowed = followState?.isFollowedByUser ?? false;

  const handleFollowed = () => onFollowed?.(user.id);

  return (
    <div className="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
      <Link className="shrink-0" href={`/users/${user.username}`}>
        <UserAvatar avatarUrl={user.avatarUrl} className="h-11 w-11" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            className="truncate font-semibold hover:underline"
            href={`/users/${user.username}`}
          >
            {user.displayName}
          </Link>
          <span className="truncate text-muted-foreground text-sm">
            @{user.username}
          </span>
        </div>

        {user.bio ? (
          <p className="mt-0.5 line-clamp-1 text-muted-foreground text-sm">
            {user.bio}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
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
      </div>

      <FollowButton
        className={cn("follow-btn-3d h-8 shrink-0 px-3 text-xs")}
        initialState={{ followers, isFollowedByUser: isFollowed }}
        onFollowed={handleFollowed}
        userId={user.id}
      />
    </div>
  );
};

export default ExploreUserRow;
