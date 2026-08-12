"use client";

import type { UserData } from "@asm/db";
import { formatDate } from "date-fns";
import { BadgeCheck, CalendarDays, Flame } from "lucide-react";
import Image from "next/image";
import type { IconType } from "react-icons";
import { FaGithub, FaLinkedin, FaReddit, FaXTwitter } from "react-icons/fa6";
import EditProfileButton from "@/components/layouts/edit-profile-button";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import { useUserDataQuery } from "@/hooks/use-user-data-query";
import { formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

interface SocialLink {
  href: string;
  icon: IconType;
  label: string;
}

function getSocialLinks(user: UserData): SocialLink[] {
  const links: SocialLink[] = [];
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
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  userData,
  isOwnProfile,
}) => {
  const { data: liveUserData } = useUserDataQuery(userData);
  const avatarUrl = liveUserData.avatarUrl
    ? getSecureImageUrl(liveUserData.avatarUrl)
    : null;

  const isFollowedByUser = Boolean(liveUserData.followers?.length);
  const followerInfo = {
    followers: liveUserData._count.followers,
    isFollowedByUser,
  };

  const joinedDate = formatDate(new Date(liveUserData.createdAt), "MMMM yyyy");
  const socialLinks = getSocialLinks(liveUserData);

  let bannerContent: React.ReactNode;
  if (liveUserData.bannerUrl) {
    bannerContent = (
      <Image
        alt={`${liveUserData.displayName || liveUserData.username}'s header`}
        className="object-cover"
        fill
        sizes="(max-width: 768px) 100vw, 600px"
        src={getSecureImageUrl(liveUserData.bannerUrl)}
        unoptimized
      />
    );
  } else if (avatarUrl) {
    bannerContent = (
      <div
        className="absolute inset-0 bg-center bg-cover"
        role="img"
        style={{
          backgroundImage: `url(${avatarUrl})`,
          filter: "blur(10px) brightness(0.75)",
          transform: "scale(1.15)",
        }}
      />
    );
  } else {
    bannerContent = (
      <div className="absolute inset-0 bg-gradient-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-80" />
    );
  }

  return (
    <div className="border-border/60 border-b">
      {/* Banner */}
      <div className="relative h-32 overflow-hidden sm:h-44">
        {bannerContent}
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background-alt))] to-transparent" />
      </div>

      {/* Avatar + actions */}
      <div className="px-4">
        <div className="-mt-14 flex items-end justify-between sm:-mt-16">
          <div className="relative">
            <UserAvatar
              avatarUrl={avatarUrl}
              className="rounded-full ring-4 ring-[hsl(var(--background-alt))]"
              size={112}
            />
            <span className="absolute right-1 bottom-1 rounded-full bg-gradient-to-b from-[#ff9500] to-[#e65500] p-1 shadow-lg">
              <Flame className="size-3.5 text-white" />
            </span>
          </div>
          <div className="mb-2">
            {isOwnProfile ? (
              <EditProfileButton user={liveUserData} />
            ) : (
              <FollowButton
                className="follow-btn-3d h-9 px-4 text-sm"
                initialState={followerInfo}
                userId={liveUserData.id}
              />
            )}
          </div>
        </div>

        {/* Identity */}
        <div className="mt-3">
          <h1 className="flex items-center gap-1.5 font-bold text-xl sm:text-2xl">
            {liveUserData.displayName || liveUserData.username}
            <BadgeCheck className="size-5 shrink-0 text-primary" />
          </h1>
          <p className="text-muted-foreground">@{liveUserData.username}</p>
        </div>

        {liveUserData.bio ? (
          <Linkify>
            <p className="mt-3 overflow-hidden whitespace-pre-line break-words text-[15px]">
              {liveUserData.bio}
            </p>
          </Linkify>
        ) : null}

        {/* Meta */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
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
                className="pill-3d-hover inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:text-foreground"
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

        {/* Stats */}
        <div className="mt-2.5 flex items-center gap-4 pb-4 text-sm">
          <span>
            <span className="font-semibold">
              {formatNumber(liveUserData._count.following)}
            </span>{" "}
            <span className="text-muted-foreground">Following</span>
          </span>
          <span>
            <span className="font-semibold">
              {formatNumber(followerInfo.followers)}
            </span>{" "}
            <span className="text-muted-foreground">Followers</span>
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-orange-500">
            <Flame className="size-4" />
            {formatNumber(liveUserData.aura)} Aura
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProfileHeader;
