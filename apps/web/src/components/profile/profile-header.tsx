"use client";

import type { UserData } from "@asm/db";
import { formatDate } from "date-fns";
import { BadgeCheck, CalendarDays, Flame } from "lucide-react";
import EditProfileButton from "@/components/layouts/edit-profile-button";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import { formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

interface ProfileHeaderProps {
  isOwnProfile: boolean;
  userData: UserData;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  userData,
  isOwnProfile,
}) => {
  const avatarUrl = userData.avatarUrl
    ? getSecureImageUrl(userData.avatarUrl)
    : null;

  const isFollowedByUser = Boolean(userData.followers?.length);
  const followerInfo = {
    followers: userData._count.followers,
    isFollowedByUser,
  };

  const joinedDate = formatDate(new Date(userData.createdAt), "MMMM yyyy");

  return (
    <div className="border-border/60 border-b">
      {/* Banner */}
      <div className="relative h-32 overflow-hidden sm:h-44">
        {avatarUrl ? (
          <div
            className="absolute inset-0 bg-center bg-cover"
            role="img"
            style={{
              backgroundImage: `url(${avatarUrl})`,
              filter: "blur(10px) brightness(0.75)",
              transform: "scale(1.15)",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-80" />
        )}
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
              <EditProfileButton user={userData} />
            ) : (
              <FollowButton
                className="follow-btn-3d h-9 px-4 text-sm"
                initialState={followerInfo}
                userId={userData.id}
              />
            )}
          </div>
        </div>

        {/* Identity */}
        <div className="mt-3">
          <h1 className="flex items-center gap-1.5 font-bold text-xl sm:text-2xl">
            {userData.displayName || userData.username}
            <BadgeCheck className="size-5 shrink-0 text-primary" />
          </h1>
          <p className="text-muted-foreground">@{userData.username}</p>
        </div>

        {userData.bio ? (
          <Linkify>
            <p className="mt-3 overflow-hidden whitespace-pre-line break-words text-[15px]">
              {userData.bio}
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

        {/* Stats */}
        <div className="mt-2.5 flex items-center gap-4 pb-4 text-sm">
          <span>
            <span className="font-semibold">
              {formatNumber(userData._count.following)}
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
            {formatNumber(userData.aura)} Aura
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProfileHeader;
