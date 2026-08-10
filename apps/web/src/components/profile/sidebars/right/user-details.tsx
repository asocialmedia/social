"use client";

import { useQuery } from "@tanstack/react-query";
import type { UserData } from "@asm/db";
import { useToast } from "@asm/ui/hooks/use-toast";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { formatDate, parseISO } from "date-fns";
import {
  BadgeCheckIcon,
  Flame,
  MoreVertical,
  UserPlus,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";
import EditProfileButton from "@/components/layouts/edit-profile-button";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import { formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";
import FollowersList from "../../followers-list";
import FollowingList from "../../following-list";

interface UserDetailsProps {
  loggedInUserId: string;
  userData: UserData;
}

const UserDetails: React.FC<UserDetailsProps> = ({
  userData: initialUserData,
  loggedInUserId,
}) => {
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const { toast } = useToast();

  const {
    data: userData,
    error,
    isLoading,
  } = useQuery({
    queryKey: ["user", initialUserData.id],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/users/${initialUserData.id}`);
        if (!response.ok) {
          throw new Error("Failed to fetch user data");
        }
        const fetchedUserData = await response.json();

        const followStates = await fetch("/api/users/follow-states", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [fetchedUserData.id] }),
        }).then((r) => r.json());

        return {
          ...fetchedUserData,
          followState: followStates[fetchedUserData.id],
        };
      } catch {
        toast({
          title: "Error",
          description: "Failed to load user data. Using cached data.",
          variant: "destructive",
        });
        return initialUserData;
      }
    },
    initialData: initialUserData,
    staleTime: 1000 * 60,
    retry: 1,
  });

  const avatarUrl = useMemo(
    () => (userData?.avatarUrl ? getSecureImageUrl(userData.avatarUrl) : null),
    [userData?.avatarUrl]
  );

  if (isLoading) {
    return <UserDetailsSkeleton />;
  }

  if (error && !userData) {
    return <div>Error loading user details</div>;
  }

  const isFollowedByUser = Boolean(userData?.followers?.length);

  const followerInfo = {
    followers: userData?._count?.followers ?? 0,
    isFollowedByUser,
  };

  const formatCreatedAt = (date: Date | string | undefined | null) => {
    try {
      if (!date) {
        return "Unknown date";
      }
      const parsedDate = typeof date === "string" ? parseISO(date) : date;
      return formatDate(parsedDate, "MMM d, yyyy");
    } catch (dateError) {
      console.error("Error formatting date:", dateError);
      return "Unknown date";
    }
  };

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="sticky top-0 overflow-hidden bg-card text-card-foreground">
        <motion.div
          animate={{ opacity: 1 }}
          className="relative h-32"
          initial={{ opacity: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <div
            className="absolute inset-0 bg-center bg-cover"
            style={{
              backgroundImage: avatarUrl ? `url(${avatarUrl})` : "none",
              filter: "blur(8px) brightness(0.9)",
              transform: "scale(1.1)",
            }}
          />
        </motion.div>
        <CardContent className="relative p-6">
          <div className="flex flex-col">
            <motion.div
              animate={{ scale: 1, opacity: 1 }}
              className="relative -mt-20 mb-4"
              initial={{ scale: 0.8, opacity: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              <UserAvatar
                avatarUrl={avatarUrl}
                className="rounded-full ring-4 ring-background"
                size={120}
              />
            </motion.div>
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="w-full space-y-3"
              initial={{ opacity: 0, x: -20 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h1 className="font-bold text-3xl">{userData.displayName}</h1>
                <div className="space-y-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <div className="flex items-center justify-end font-semibold text-foreground text-lg">
                              <Flame className="mr-1 h-6 w-6 text-orange-500" />
                              {formatNumber(userData?.aura ?? 0)}{" "}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Total Aura Points</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipContent>
                        <p>Aura</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <motion.div
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-end gap-1.5 text-sm"
                    initial={{ opacity: 0 }}
                  >
                    <span className="font-medium">
                      {formatNumber(userData?._count?.posts ?? 0)}
                    </span>
                    <span className="text-muted-foreground">posts</span>
                  </motion.div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center text-muted-foreground">
                  @{userData.username}
                  <BadgeCheckIcon className="ml-1 h-4 w-4" />
                </div>
                <div className="text-muted-foreground">
                  Member since{" "}
                  {userData?.createdAt
                    ? formatCreatedAt(userData.createdAt)
                    : "Unknown date"}
                </div>

                <div className="flex items-center gap-4">
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="relative"
                    initial={{ opacity: 0, y: 20 }}
                    transition={{ delay: 0.45 }}
                  >
                    <motion.button
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all duration-200 hover:bg-accent/50"
                      onClick={() => setShowFollowers(true)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Users className="h-4 w-4 text-primary" />
                      <span>
                        <span className="font-semibold">
                          {formatNumber(followerInfo.followers)}
                        </span>{" "}
                        <span className="text-muted-foreground">Followers</span>
                      </span>
                    </motion.button>
                  </motion.div>

                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="relative"
                    initial={{ opacity: 0, y: 20 }}
                    transition={{ delay: 0.5 }}
                  >
                    <motion.button
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all duration-200 hover:bg-accent/50"
                      onClick={() => setShowFollowing(true)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <UserPlus className="h-4 w-4 text-primary" />
                      <span>
                        <span className="font-semibold">
                          {formatNumber(userData?._count?.following ?? 0)}
                        </span>{" "}
                        <span className="text-muted-foreground">Following</span>
                      </span>
                    </motion.button>
                  </motion.div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {userData.id === loggedInUserId ? (
                  <EditProfileButton user={userData} />
                ) : (
                  <FollowButton
                    initialState={
                      userData.followState || {
                        followers: userData._count.followers,
                        isFollowedByUser: false,
                      }
                    }
                    userId={userData.id}
                  />
                )}
                <Button
                  aria-label="More options"
                  disabled
                  size="icon"
                  variant="ghost"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          </div>
          {userData.bio && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              <hr className="my-4" />
              <Linkify>
                <div className="overflow-hidden whitespace-pre-line break-words">
                  {userData.bio}
                </div>
              </Linkify>
            </motion.div>
          )}
        </CardContent>
      </Card>
      <FollowersList
        isOpen={showFollowers}
        loggedInUserId={loggedInUserId}
        onCloseAction={() => setShowFollowers(false)}
        userId={userData?.id ?? ""}
      />
      <FollowingList
        isOpen={showFollowing}
        loggedInUserId={loggedInUserId}
        onCloseAction={() => setShowFollowing(false)}
        userId={userData?.id ?? ""}
      />
    </motion.div>
  );
};

export default UserDetails;

const UserDetailsSkeleton = () => (
  <Card className="sticky top-0 overflow-hidden bg-card text-card-foreground">
    <div className="relative h-32">
      <Skeleton className="h-full w-full" />
    </div>
    <CardContent className="relative p-6">
      <div className="flex flex-col">
        <div className="relative -mt-20 mb-4">
          <Skeleton className="size-[120px] rounded-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);
