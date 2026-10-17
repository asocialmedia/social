"use client";

import type { UserCommunityRole, UserData } from "@asm/db";
import type { ExternalAuthor } from "@asm/protocols/contracts";
import { formatDate } from "date-fns";
import { CalendarDays, Flame, Globe, Info, MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";
import {
  FaBluesky,
  FaGithub,
  FaLinkedin,
  FaReddit,
  FaXTwitter,
} from "react-icons/fa6";

import { useSession } from "@/app/(main)/session-provider";
import EditProfileButton from "@/components/layouts/user/edit-profile-button";
import FollowButton from "@/components/layouts/user/follow-button";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import PostLinkedContent from "@/components/posts/content/post-linked-content";
import CommunityRoleSummary from "@/components/profile/community-role-summary";
import { ProfileMutualAvatars } from "@/components/profile/profile-mutual-avatars";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import type { PrivateUserData } from "@/hooks/users/use-user-data";
import { useUserDataQuery } from "@/hooks/users/use-user-data-query";
import { getAuraFlameClass } from "@/lib/aura/aura";
import { getUserCount } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

interface SocialLink {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

function getSocialLinks(user: UserData): SocialLink[] {
  const links: SocialLink[] = [];
  if (user.customDomain) {
    const domain = user.customDomain.replace(/^https?:\/\//, "");
    links.push({
      href: `https://${domain}`,
      icon: Globe,
      label: `Website: ${domain}`,
    });
  }
  if (user.blueskyHandle) {
    const handle = user.blueskyHandle.replace(/^@/, "");
    links.push({
      href: `https://bsky.app/profile/${handle}`,
      icon: FaBluesky,
      label: `Bluesky: @${handle}`,
    });
  }
  if (user.githubUsername) {
    links.push({
      href: `https://github.com/${user.githubUsername}`,
      icon: FaGithub,
      label: `GitHub: ${user.githubUsername}`,
    });
  }
  if (user.linkedinUsername) {
    links.push({
      href: `https://www.linkedin.com/in/${user.linkedinUsername}`,
      icon: FaLinkedin,
      label: `LinkedIn: ${user.linkedinUsername}`,
    });
  }
  if (user.twitterUsername) {
    links.push({
      href: `https://x.com/${user.twitterUsername}`,
      icon: FaXTwitter,
      label: `Twitter / X: ${user.twitterUsername}`,
    });
  }
  if (user.redditUsername) {
    links.push({
      href: `https://www.reddit.com/user/${user.redditUsername}`,
      icon: FaReddit,
      label: `Reddit: ${user.redditUsername}`,
    });
  }
  return links;
}

interface ProfileHeaderProps {
  external?: ExternalAuthor;
  // The badged community roles this user holds, shown under the identity so a
  // profile states which communities they own or moderate.
  communityRoles?: UserCommunityRole[];
  isOwnProfile: boolean;
  userData: UserData;
  // The session owner's own data (includes avatarKey/bannerKey needed by the
  // edit dialog). Only ever provided for the owner's own profile.
  ownUserData?: PrivateUserData | null;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  userData,
  isOwnProfile,
  ownUserData,
  communityRoles,
  external,
}) => {
  const { data: liveUserData } = useUserDataQuery(userData, !external);
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const isLoggedIn = Boolean(user);

  // Guests get bounced to login; logged-in users deep-link into a DM thread.
  const handleMessageClick = useCallback(
    (event: React.MouseEvent) => {
      if (!isLoggedIn) {
        event.preventDefault();
        goToLogin();
      }
    },
    [goToLogin, isLoggedIn]
  );
  const avatarUrl = liveUserData.avatarUrl
    ? getSecureImageUrl(liveUserData.avatarUrl)
    : null;

  const isFollowedByUser = Boolean(liveUserData.followers?.length);
  const followerInfo = {
    followers: getUserCount(liveUserData, "followers"),
    isFollowedByUser,
  };

  const [bannerFailed, setBannerFailed] = useState(false);
  const joinedDate = formatDate(new Date(liveUserData.createdAt), "MMMM yyyy");
  const socialLinks = getSocialLinks(liveUserData);

  // The edit dialog needs the owner's private avatarKey/bannerKey, so it only
  // renders when the private own-user payload is present; non-own profiles get
  // the follow/message actions instead.
  let profileActions: React.ReactNode = null;
  if (isOwnProfile) {
    if (ownUserData) {
      profileActions = (
        <EditProfileButton
          className="text-[13px] sm:text-sm"
          user={ownUserData}
        />
      );
    }
  } else if (external) {
    profileActions = (
      <a
        className="btn-3d-bluesky inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs whitespace-nowrap sm:px-4 sm:text-sm"
        href={external.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        <BlueskyIcon className="text-white" tooltip={false} />
        Visit on Bluesky
      </a>
    );
  } else {
    profileActions = (
      <div className="flex flex-col items-end gap-2">
        <FollowButton
          className="h-9 px-4 text-[13px]! sm:text-sm!"
          initialState={followerInfo}
          userId={liveUserData.id}
        />
        <Link
          aria-label={`Message ${liveUserData.displayName || liveUserData.username}`}
          className="btn-3d-gray flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px]! sm:text-sm!"
          href={`/messages?dm=${liveUserData.id}`}
          onClick={handleMessageClick}
        >
          <MessageCircle className="h-4 w-4" />
          Message
        </Link>
      </div>
    );
  }

  let bannerContent: React.ReactNode;
  if (liveUserData.bannerUrl && !bannerFailed) {
    bannerContent = (
      <Image
        alt={`${liveUserData.displayName || liveUserData.username}'s header`}
        className="object-cover"
        fill
        onError={() => setBannerFailed(true)}
        sizes="(max-width: 768px) 100vw, 600px"
        src={getSecureImageUrl(liveUserData.bannerUrl)}
        unoptimized
      />
    );
  } else if (avatarUrl) {
    bannerContent = (
      <Image
        alt=""
        className="object-cover"
        fill
        sizes="(max-width: 768px) 100vw, 600px"
        src={avatarUrl}
        style={{
          filter: "blur(10px) brightness(0.75)",
          transform: "scale(1.15)",
        }}
        unoptimized
      />
    );
  } else {
    bannerContent = (
      <div className="absolute inset-0 bg-linear-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-80" />
    );
  }

  return (
    <div className="border-border/60 border-b">
      {/* Banner */}
      <div className="bg-muted/20 relative h-32 overflow-hidden sm:h-44">
        {bannerContent}
        <div className="absolute inset-0 bg-linear-to-t from-[hsl(var(--background-alt))] to-transparent" />
      </div>

      {/* Avatar + social links */}
      <div className="px-4">
        <div className="-mt-12 flex items-end justify-between sm:-mt-16">
          <div className="relative shrink-0 self-start">
            <UserAvatar
              avatarUrl={avatarUrl}
              className="size-24 ring-4 ring-[hsl(var(--background-alt))] sm:size-28"
              size={112}
              user={liveUserData}
            />
          </div>
          {/* Social links */}
          {socialLinks.length > 0 ? (
            <div className="relative mt-12 mb-2 flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 pl-3 sm:mt-16">
              {socialLinks.map((link) => (
                <a
                  aria-label={link.label}
                  className="pill-3d-hover text-muted-foreground hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200"
                  href={link.href}
                  key={link.label}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <link.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {/* Identity */}
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-1.5 text-base/5 font-bold wrap-anywhere sm:text-2xl">
              {liveUserData.displayName || liveUserData.username}
              {external ? (
                <BlueskyIcon />
              ) : (
                <UserBadge
                  badge={liveUserData.badge}
                  badges={liveUserData.badges}
                  className="h-5 w-15 sm:h-8 sm:w-24"
                  communityRoles={communityRoles}
                />
              )}
            </h1>
            <p className="text-muted-foreground text-[13px]/4.5 wrap-anywhere sm:text-base/6">
              @{liveUserData.username}
            </p>
            {external ? null : (
              <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] sm:text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4 shrink-0" />
                  Joined {joinedDate}
                </span>
              </div>
            )}
          </div>
          <div className="shrink-0">{profileActions}</div>
        </div>

        {/* Community roles: what this account does across the platform, one
            line per role, e.g. "[owner] Owner of a/anime & a/cosplay". */}
        {communityRoles && communityRoles.length > 0 ? (
          <CommunityRoleSummary className="mt-3" roles={communityRoles} />
        ) : null}

        {liveUserData.bio ? (
          <PostLinkedContent
            className="mt-3 overflow-hidden text-sm/5.5 sm:text-[15px]/relaxed"
            content={liveUserData.bio}
            linkBadge="chip"
          />
        ) : null}

        {/* Stats */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 pb-4 text-[13px] sm:text-sm">
          {external ? (
            <>
              <span>
                <strong>
                  {formatNumber(external.upstreamCounts.following ?? 0)}
                </strong>{" "}
                Following
              </span>
              <span>
                <strong>
                  {formatNumber(external.upstreamCounts.followers ?? 0)}
                </strong>{" "}
                Followers
              </span>
              <span>
                <strong>
                  {formatNumber(external.upstreamCounts.posts ?? 0)}
                </strong>{" "}
                Posts
              </span>
            </>
          ) : (
            <>
              <Link
                className="group hover:bg-accent/50 inline-flex items-center gap-1 rounded-md px-1 py-0.5 whitespace-nowrap transition-colors"
                href={`/users/${liveUserData.username}/following`}
              >
                <span className="font-semibold">
                  {formatNumber(getUserCount(liveUserData, "following"))}
                </span>{" "}
                <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                  Following
                </span>
                <ProfileMutualAvatars
                  kind="following"
                  total={liveUserData.mutuals?.counts?.following}
                  users={liveUserData.mutuals?.following}
                />
              </Link>
              <Link
                className="group hover:bg-accent/50 inline-flex items-center gap-1 rounded-md px-1 py-0.5 whitespace-nowrap transition-colors"
                href={`/users/${liveUserData.username}/followers`}
              >
                <span className="font-semibold">
                  {formatNumber(followerInfo.followers)}
                </span>{" "}
                <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                  Followers
                </span>
                <ProfileMutualAvatars
                  kind="followers"
                  total={liveUserData.mutuals?.counts?.followers}
                  users={liveUserData.mutuals?.followers}
                />
              </Link>
              <span
                className="inline-flex items-center gap-1.5 font-bold"
                title="Aura"
              >
                <Flame
                  className={[
                    "size-4 sm:size-5",
                    getAuraFlameClass(liveUserData.aura),
                  ].join(" ")}
                />
                <span className="text-sm tabular-nums sm:text-base">
                  {formatNumber(liveUserData.aura)}
                </span>
                <span className="text-muted-foreground text-[13px] font-semibold sm:text-sm">
                  Aura
                </span>
              </span>
            </>
          )}
        </div>
        {external ? (
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 pb-4 text-xs">
            <Info className="size-3.5 shrink-0" />
            <span
              className="truncate"
              title="This profile is from Bluesky. Interactions here stay on asocialmedia."
            >
              This profile is from Bluesky. Interactions here stay on
              asocialmedia.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default ProfileHeader;
