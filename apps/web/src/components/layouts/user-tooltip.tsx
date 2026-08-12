"use client";

import type { FollowerInfo, UserData } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import Link from "next/link";
import { type PropsWithChildren, useEffect, useState } from "react";
import { useSession } from "@/app/(main)/session-provider";
import Linkify from "@/helpers/global/linkify";
import FollowButton from "./follow-button";
import FollowerCount from "./follower-count";
import UserAvatar from "./user-avatar";

interface UserTooltipProps extends PropsWithChildren {
  user: UserData;
}

export default function UserTooltip({ children, user }: UserTooltipProps) {
  const { user: loggedInUser } = useSession();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsMobile(window.innerWidth < 768);
      const handleResize = () => {
        setIsMobile(window.innerWidth < 768);
      };

      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }
  }, []);

  const followerState: FollowerInfo = {
    followers: user._count.followers,
    isFollowedByUser: user.followers
      ? !!user.followers.some(
          ({ followerId }) => followerId === loggedInUser?.id
        )
      : false,
  };

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="apple-panel overflow-hidden bg-transparent p-1.5 shadow-none">
          <div className="flex max-w-80 flex-col gap-3 break-words px-1 py-2.5 md:min-w-52">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/users/${user.username}`}>
                <UserAvatar avatarUrl={user.avatarUrl} size={70} />
              </Link>
              {loggedInUser && loggedInUser.id !== user.id && (
                <FollowButton initialState={followerState} userId={user.id} />
              )}
            </div>
            <div>
              <Link href={`/users/${user.username}`}>
                <div className="font-semibold text-card-foreground text-lg hover:underline">
                  {user.displayName}
                </div>
                <div className="text-muted-foreground">@{user.username}</div>
              </Link>
            </div>
            {user.bio ? (
              <Linkify>
                <div className="line-clamp-4 whitespace-pre-line text-card-foreground">
                  {user.bio}
                </div>
              </Linkify>
            ) : null}
            <div className="text-card-foreground">
              <FollowerCount initialState={followerState} userId={user.id} />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
