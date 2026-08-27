"use client";

import type { PrivateUserData, UserData } from "@asm/db";
import { formatDate } from "date-fns";
import { CalendarDays, Flame, Globe, MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";
import { FaGithub, FaLinkedin, FaReddit, FaXTwitter } from "react-icons/fa6";

import { useSession } from "@/app/(main)/session-provider";
import ShareButton from "@/components/home/feedview/share-button";
import EditProfileButton from "@/components/layouts/edit-profile-button";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import Linkify from "@/helpers/global/linkify";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { getAuraFlameClass } from "@/lib/aura";
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
}) => {
  const { data: liveUserData } = useUserDataQuery(userData);
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
    followers: liveUserData._count.followers,
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
      profileActions = <EditProfileButton user={ownUserData} />;
    }
  } else {
    profileActions = (
      <div className="flex flex-col items-end gap-2">
        <FollowButton
          className="h-9 px-4 text-sm"
          initialState={followerInfo}
          userId={liveUserData.id}
        />
        <Link
          aria-label={`Message ${liveUserData.displayName || liveUserData.username}`}
          className="btn-3d-gray flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm!"
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

      {/* Avatar + actions */}
      <div className="px-4">
        <div className="-mt-14 flex items-end justify-between sm:-mt-16">
          <div className="relative mb-8">
            <UserAvatar
              avatarUrl={avatarUrl}
              className="ring-4 ring-[hsl(var(--background-alt))]"
              size={112}
              user={liveUserData}
            />
          </div>
          <div className="mb-2 flex items-center gap-2">{profileActions}</div>
        </div>

        {/* Identity */}
        <div className="mt-3">
          <h1 className="flex items-center gap-1.5 text-xl font-bold sm:text-2xl">
            {liveUserData.displayName || liveUserData.username}
            <UserBadge
              badge={liveUserData.badge}
              badges={liveUserData.badges}
              className="h-8 w-24"
            />
          </h1>
          <p className="text-muted-foreground">@{liveUserData.username}</p>
        </div>

        {liveUserData.bio ? (
          <Linkify>
            <p className="mt-3 overflow-hidden text-[15px] wrap-break-word whitespace-pre-line">
              {liveUserData.bio}
            </p>
          </Linkify>
        ) : null}

        {/* Meta */}
        <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4" />
            Joined {joinedDate}
          </span>
        </div>

        {/* Social links */}
        {socialLinks.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
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

        {/* Stats + share, on the same row with the share pinned right */}
        <div className="mt-2.5 flex items-center gap-4 pb-4 text-sm">
          <Link
            className="group hover:bg-accent/50 rounded-md px-1 py-0.5 transition-colors"
            href={`/users/${liveUserData.username}/following`}
          >
            <span className="font-semibold">
              {formatNumber(liveUserData._count.following)}
            </span>{" "}
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
              Following
            </span>
          </Link>
          <Link
            className="group hover:bg-accent/50 rounded-md px-1 py-0.5 transition-colors"
            href={`/users/${liveUserData.username}/followers`}
          >
            <span className="font-semibold">
              {formatNumber(followerInfo.followers)}
            </span>{" "}
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
              Followers
            </span>
          </Link>
          <span
            className="inline-flex items-center gap-1.5 font-bold"
            title="Aura"
          >
            <Flame
              className={["size-5", getAuraFlameClass(liveUserData.aura)].join(
                " "
              )}
            />
            <span className="text-base tabular-nums">
              {formatNumber(liveUserData.aura)}
            </span>
            <span className="text-muted-foreground text-sm font-semibold">
              Aura
            </span>
          </span>

          <span className="ml-auto">
            <ShareButton
              className="icon-btn-3d flex h-9! w-9! shrink-0 -translate-y-0.5 items-center justify-center rounded-full px-0!"
              defaultTab="link"
              description={
                liveUserData.bio ||
                `Check out @${liveUserData.username}'s profile on asocialmedia`
              }
              dialogDescription="Share this profile with your network"
              dialogTitle="Share Profile"
              shareUrl={
                typeof window === "undefined"
                  ? undefined
                  : `${window.location.origin}/users/${liveUserData.username}`
              }
              thumbnail={avatarUrl || undefined}
              title={`${liveUserData.displayName || liveUserData.username} (@${liveUserData.username}) on asocialmedia`}
            />
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProfileHeader;
