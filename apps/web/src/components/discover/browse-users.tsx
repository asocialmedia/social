"use client";

import type { UserData as BaseUserData } from "@asm/db";
import { Card } from "@asm/ui/shadui/card";
import { Input } from "@asm/ui/shadui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@asm/ui/shadui/select";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheckIcon, Search, Users } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback, useState } from "react";
import FollowButton from "@/components/layouts/follow-button";
import UserAvatar from "@/components/layouts/user-avatar";
import useDebounce from "@/hooks/use-debounce";
import { formatNumber } from "@/lib/utils";

interface UserData extends BaseUserData {
  followState?: {
    followers: number;
    isFollowedByUser: boolean;
  };
}

interface BrowseUsersProps {
  userId?: string;
}

const BrowseUsers: React.FC<BrowseUsersProps> = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("followers");
  const debouncedSearch = useDebounce(searchTerm, 300);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
    },
    []
  );

  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ["browse-users", debouncedSearch, sortBy],
    queryFn: async () => {
      const params = new URLSearchParams({
        search: debouncedSearch,
        sortBy,
      });
      const response = await fetch(`/api/users/browse?${params}`);
      const browseUsers = await response.json();

      const followStates = await fetch("/api/users/follow-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: browseUsers.map((u: UserData) => u.id),
        }),
      }).then((r) => r.json());

      return browseUsers.map((user: UserData) => ({
        ...user,
        followState: followStates[user.id],
      }));
    },
  });

  return (
    <div className="mr-0 space-y-6 md:mr-4">
      <div className="mr-2 flex items-center justify-between">
        <h2 className="font-bold text-2xl">Browse Users</h2>
        <div className="flex items-center gap-2">
          <Select onValueChange={setSortBy} value={sortBy}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="followers">Most Followers</SelectItem>
              <SelectItem value="posts">Most Posts</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={handleSearchChange}
            placeholder="Search users..."
            value={searchTerm}
          />
        </div>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {["a", "b", "c", "d", "e", "f"].map((id) => (
            <Skeleton
              className="h-[100px] w-full rounded-lg bg-muted"
              key={`browse-skeleton-${id}`}
            />
          ))}
        </div>
      ) : (
        <motion.div
          animate={{ opacity: 1 }}
          className="grid gap-4 md:grid-cols-2"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
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
                    <span>{formatNumber(user._count.posts)} posts</span>
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
        </motion.div>
      )}
    </div>
  );
};

export default BrowseUsers;
