"use client";

import { useQuery } from "@tanstack/react-query";
import type { UserData as BaseUserData } from "@asm/db";
import { Card } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { BadgeCheckIcon, Users } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import { formatNumber } from "@/lib/utils";

interface UserData extends BaseUserData {
  followState?: {
    followers: number;
    isFollowedByUser: boolean;
  };
}

interface NewUsersProps {
  userId?: string;
}

const NewUsers: React.FC<NewUsersProps> = () => {
  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ["new-users"],
    queryFn: async () => {
      const response = await fetch("/api/users/new");
      const newUsers = await response.json();

      const followStates = await fetch("/api/users/follow-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: newUsers.map((u: UserData) => u.id) }),
      }).then((r) => r.json());

      return newUsers.map((user: UserData) => ({
        ...user,
        followState: followStates[user.id],
      }));
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {["1", "2", "3", "4", "5", "6"].map((id) => (
          <Skeleton
            className="h-[100px] w-full rounded-lg bg-muted"
            key={`new-skeleton-${id}`}
          />
        ))}
      </div>
    );
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="mr-0 space-y-6 md:mr-4"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-2xl">New Users</h2>
        <p className="text-muted-foreground text-sm">
          Welcome our newest members
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {users?.map((user, index) => (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 20 }}
            key={user.id}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="flex items-center gap-4 p-4 hover:bg-muted/50">
              <UserAvatar
                avatarUrl={user.avatarUrl}
                className="shrink-0"
                size={56}
              />
              <div className="min-w-0 flex-grow">
                <div className="flex items-center gap-1">
                  <Link
                    className="truncate font-semibold hover:underline"
                    href={`/users/${user.username}`}
                  >
                    {user.displayName}
                  </Link>
                  <BadgeCheckIcon className="h-4 w-4 shrink-0" />
                </div>
                <div className="truncate text-muted-foreground text-sm">
                  @{user.username}
                </div>
                <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
                  <Users className="h-3 w-3" />
                  <span>{formatNumber(user._count.followers)} followers</span>
                  <span>•</span>
                  <span>
                    Joined {formatDistanceToNow(new Date(user.createdAt))} ago
                  </span>
                </div>
              </div>
              <FollowButton
                initialState={
                  user.followState || {
                    followers: user._count.followers,
                    isFollowedByUser: false,
                  }
                }
                userId={user.id}
              />
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default NewUsers;
