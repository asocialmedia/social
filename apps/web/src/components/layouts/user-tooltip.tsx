"use client";

import type { FollowerInfo, UserData } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import { LinkIt, LinkItUrl } from "react-linkify-it";

import { useSession } from "@/app/(main)/session-provider";

import FollowButton from "./follow-button";
import FollowerCount from "./follower-count";
import UserAvatar from "./user-avatar";

interface UserTooltipProps extends PropsWithChildren {
  user: UserData;
}

const BIO_USERNAME_REGEX = /(?<username>@[a-zA-Z0-9_-]+)/;
const BIO_HASHTAG_REGEX = /(?<hashtag>#[a-zA-Z0-9]+)/;

function renderBioUsernameLink(match: string, key: number) {
  return (
    <Link
      className="text-primary hover:underline"
      href={`/users/${match.slice(1)}`}
      key={key}
    >
      {match}
    </Link>
  );
}

function renderBioHashtagLink(match: string, key: number) {
  return (
    <Link
      className="text-primary hover:underline"
      href={`/hashtag/${match.slice(1)}`}
      key={key}
    >
      {match}
    </Link>
  );
}

export default function UserTooltip({ children, user }: UserTooltipProps) {
  const { user: loggedInUser } = useSession();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-compiler -- detect the initial viewport size on mount
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
    followers: user._count?.followers ?? 0,
    isFollowedByUser: user.followers
      ? !!user.followers.some(
          ({ followerId }) => followerId === loggedInUser?.id
        )
      : false,
  };

  if (isMobile) {
    return children;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="apple-panel overflow-hidden bg-transparent p-1.5 shadow-none">
          <div className="flex max-w-80 flex-col gap-3 px-1 py-2.5 break-words md:min-w-52">
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
                <div className="text-card-foreground text-lg font-semibold hover:underline">
                  {user.displayName}
                </div>
                <div className="text-muted-foreground">@{user.username}</div>
              </Link>
            </div>
            {user.bio ? (
              <LinkIt
                component={renderBioUsernameLink}
                regex={BIO_USERNAME_REGEX}
              >
                <LinkIt
                  component={renderBioHashtagLink}
                  regex={BIO_HASHTAG_REGEX}
                >
                  <LinkItUrl className="text-primary hover:underline">
                    <div className="text-card-foreground line-clamp-4 whitespace-pre-line">
                      {user.bio}
                    </div>
                  </LinkItUrl>
                </LinkIt>
              </LinkIt>
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
