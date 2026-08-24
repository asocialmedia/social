"use client";

import type { FollowerInfo, UserData } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import Link from "next/link";
import type { PropsWithChildren } from "react";
import { useSyncExternalStore } from "react";
import { LinkIt, LinkItUrl } from "react-linkify-it";

import { useSession } from "@/app/(main)/session-provider";

import FollowButton from "./follow-button";
import FollowerCount from "./follower-count";
import UserAvatar from "./user-avatar";
import UserBadge from "./user-badge";

interface UserTooltipProps extends PropsWithChildren {
  user: UserData;
}

const BIO_USERNAME_REGEX = /(?<username>@[a-zA-Z0-9_-]+)/;
const BIO_HASHTAG_REGEX = /(?<hashtag>#[a-zA-Z0-9]+)/;

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
  const isMobile = useSyncExternalStore(
    subscribeToViewport,
    getIsMobileSnapshot,
    getServerIsMobile
  );

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
                <div className="text-card-foreground flex items-center gap-1.5 text-lg font-semibold hover:underline">
                  {user.displayName}
                  <UserBadge badge={user.badge} badges={user.badges} />
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
