"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserData } from "@asm/db";
import { Card } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { BadgeCheckIcon, MessageSquare, Sparkles, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback, useState } from "react";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import { useFollowStates } from "@/hooks/use-follow-states";
import { formatNumber } from "@/lib/utils";

interface SuggestedUsersProps {
  userId?: string;
}

interface EnhancedUserData extends UserData {
  followState?: {
    followers: number;
    isFollowedByUser: boolean;
  };
  mutualFollowers?: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  }[];
}

const MutualFollowers = ({
  followers,
}: {
  followers: NonNullable<EnhancedUserData["mutualFollowers"]>;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (followers.length === 0) {
    return null;
  }

  const displayCount = 3;
  const remainingCount = Math.max(0, followers.length - displayCount);
  const displayedFollowers = followers.slice(0, displayCount);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {displayedFollowers.map((follower) => (
            <TooltipProvider key={follower.username}>
              <Tooltip>
                <TooltipTrigger>
                  <Link href={`/users/${follower.username}`}>
                    <UserAvatar
                      avatarUrl={follower.avatarUrl}
                      className="ring-2 ring-background transition-all duration-300 hover:ring-primary"
                      size={24}
                    />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{follower.displayName}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
        <motion.p
          animate={{ opacity: isHovered ? 1 : 0.7 }}
          className="text-muted-foreground text-xs"
          initial={false}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          Followed by{" "}
          {displayedFollowers.map((follower, index) => (
            <span key={follower.username}>
              <Link
                className="font-medium text-foreground hover:underline"
                href={`/users/${follower.username}`}
              >
                {follower.displayName}
              </Link>
              {index < displayedFollowers.length - 1 && ", "}
            </span>
          ))}
          {remainingCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <span className="ml-1 font-medium text-foreground">
                    and {remainingCount} more
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {followers
                      .slice(displayCount)
                      .map((f) => f.displayName)
                      .join(", ")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </motion.p>
      </div>
    </div>
  );
};

const UserCard = ({
  user,
  index,
  onFollowed,
  initialFollowState,
}: {
  user: EnhancedUserData;
  index: number;
  onFollowed: () => void;
  initialFollowState?: boolean;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className="relative"
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      initial={{ opacity: 0, scale: 0.8 }}
      layout
      onHoverEnd={() => setIsHovered(false)}
      onHoverStart={() => setIsHovered(true)}
      transition={{
        layout: { duration: 0.3 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 },
        type: "spring",
        stiffness: 200,
        damping: 20,
      }}
    >
      <Card className="group relative h-full overflow-hidden bg-gradient-to-br from-background to-muted/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,#000,transparent_70%)]" />
        </div>

        <div className="relative p-6">
          <div className="flex items-center justify-between">
            <motion.div
              animate={{ scale: isHovered ? 1.05 : 1 }}
              initial={false}
              transition={{ duration: 0.2 }}
            >
              <Link href={`/users/${user.username}`}>
                <UserAvatar
                  avatarUrl={user.avatarUrl}
                  className="ring-4 ring-background transition-all duration-300 hover:ring-primary"
                  size={80}
                />
              </Link>
            </motion.div>

            <div className="flex flex-col items-end space-y-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.div
                      className="flex cursor-help items-center gap-2 text-muted-foreground"
                      transition={{ duration: 0.2 }}
                      whileHover={{ scale: 1.05 }}
                    >
                      <Users className="h-4 w-4" />
                      <span className="font-medium text-sm">
                        {formatNumber(user._count.followers)}
                      </span>
                    </motion.div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{formatNumber(user._count.followers)} followers</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.div
                      className="flex cursor-help items-center gap-2 text-muted-foreground"
                      transition={{ duration: 0.2 }}
                      whileHover={{ scale: 1.05 }}
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span className="font-medium text-sm">
                        {formatNumber(user._count.posts)}
                      </span>
                    </motion.div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{formatNumber(user._count.posts)} posts</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <motion.div
                  className="flex items-center gap-1"
                  transition={{ duration: 0.2 }}
                  whileHover={{ scale: 1.02 }}
                >
                  <Link
                    className="font-bold text-lg hover:underline"
                    href={`/users/${user.username}`}
                  >
                    {user.displayName}
                  </Link>
                  <motion.div
                    animate={{ rotate: 0, opacity: 1 }}
                    initial={{ rotate: -20, opacity: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <BadgeCheckIcon className="h-4 w-4 text-primary" />
                  </motion.div>
                </motion.div>
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="text-muted-foreground text-sm"
                  initial={{ opacity: 0, y: 5 }}
                  transition={{ delay: index * 0.1 + 0.1 }}
                >
                  @{user.username}
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {user.bio && (
                <motion.div
                  animate={{ opacity: 1, height: "auto" }}
                  className="overflow-hidden"
                  exit={{ opacity: 0, height: 0 }}
                  initial={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Linkify>
                    <p className="line-clamp-2 text-muted-foreground text-sm">
                      {user.bio}
                    </p>
                  </Linkify>
                </motion.div>
              )}
            </AnimatePresence>
            {user.mutualFollowers && (
              <MutualFollowers followers={user.mutualFollowers} />
            )}
          </div>
          <motion.div
            animate={{
              y: isHovered ? 0 : 5,
              opacity: isHovered ? 1 : 0.9,
            }}
            className="mt-4"
            initial={false}
            transition={{ duration: 0.2 }}
          >
            <FollowButton
              className="w-full bg-primary/90 hover:bg-primary"
              initialState={{
                followers: user._count.followers,
                isFollowedByUser: initialFollowState ?? false,
              }}
              onFollowed={onFollowed}
              userId={user.id}
            />
          </motion.div>
        </div>

        <motion.div
          animate={{
            opacity: isHovered ? 0.3 : 0.2,
            scale: isHovered ? 1.1 : 1,
          }}
          className="absolute -top-4 -right-4 h-20 w-20 rotate-45 bg-gradient-to-br from-primary/20 to-transparent blur-2xl"
          initial={false}
          transition={{ duration: 0.3 }}
        />
        <motion.div
          animate={{
            opacity: isHovered ? 0.3 : 0.2,
            scale: isHovered ? 1.1 : 1,
          }}
          className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-3xl"
          initial={false}
          transition={{ duration: 0.3 }}
        />
      </Card>
    </motion.div>
  );
};

const SuggestedUsers: React.FC<SuggestedUsersProps> = ({ userId }) => {
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery<EnhancedUserData[]>({
    queryKey: ["suggested-users", userId],
    queryFn: async () => {
      const response = await fetch("/api/users/suggested");
      if (!response.ok) {
        throw new Error("Failed to fetch suggested users");
      }
      return response.json();
    },
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: followStates } = useFollowStates(users?.map((u) => u.id) || []);

  const _enhancedUsers = users?.map((user) => ({
    ...user,
    followState: followStates?.[user.id],
  }));

  const handleUserFollowed = useCallback(
    (followedUserId: string) => {
      queryClient.setQueryData<EnhancedUserData[]>(
        ["suggested-users", userId],
        (oldData) => {
          if (!oldData) {
            return [];
          }
          return oldData.filter((user) => user.id !== followedUserId);
        }
      );

      queryClient.invalidateQueries({
        queryKey: ["suggested-users", userId],
      });
    },
    [queryClient, userId]
  );

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["x", "y", "z", "w", "v", "u"].map((id) => (
          <Card className="p-6" key={`suggested-skeleton-${id}`}>
            <div className="flex justify-between">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-20 w-full" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="space-y-6"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-yellow-500" />
        <h2 className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text font-bold text-2xl text-transparent">
          Suggested for you
        </h2>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {users?.map((user, index) => (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              initial={{ opacity: 0, scale: 0.8 }}
              key={user.id}
              layout
              transition={{
                duration: 0.2,
                delay: index * 0.05,
              }}
            >
              <UserCard
                index={index}
                initialFollowState={user.followState?.isFollowedByUser}
                onFollowed={() => handleUserFollowed(user.id)}
                user={{
                  ...user,
                  _count: {
                    ...user._count,
                    followers:
                      user.followState?.followers ?? user._count.followers,
                  },
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {users?.length === 0 && (
        <motion.div
          animate={{ opacity: 1 }}
          className="py-10 text-center text-muted-foreground"
          initial={{ opacity: 0 }}
        >
          <p>No more suggestions available at the moment.</p>
        </motion.div>
      )}
    </motion.div>
  );
};

export default SuggestedUsers;
