"use client";

import type { UserData } from "@asm/db";
import { Card, CardContent, CardTitle } from "@asm/ui/shadui/card";
import { ScrollArea } from "@asm/ui/shadui/scroll-area";
import { Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useState } from "react";
import FriendsSkeleton from "@/components/layouts/skeletons/friends-skeleton";
import UnfollowUserDialog from "@/components/layouts/unfollow-user-dialog";
import { useFollowedUsers } from "@/hooks/user-follower-info";
import { FriendListItem } from "./friend-list-item";
import { getRandomTitle } from "./random-titles";
import { ViewSwitcher } from "./view-switcher";

interface FriendsProps {
  isCollapsed: boolean;
}

interface FriendsListProps {
  followedUsers: UserData[];
  onUnfollow: (user: UserData) => void;
  viewType: "grid" | "list";
}

const FriendsList: React.FC<FriendsListProps> = ({
  followedUsers,
  viewType,
  onUnfollow,
}) => (
  <AnimatePresence mode="wait">
    <motion.div
      className={`grid gap-3 ${
        viewType === "grid" ? "grid-cols-2" : "grid-cols-1"
      }`}
      layout
    >
      {followedUsers?.map((user) => (
        <FriendListItem
          key={user.id}
          onUnfollow={onUnfollow}
          user={user}
          viewType={viewType}
        />
      ))}
    </motion.div>
  </AnimatePresence>
);

const Friends: React.FC<FriendsProps> = ({ isCollapsed }) => {
  const { data: followedUsers, isLoading } = useFollowedUsers();
  const [title, _setTitle] = useState(getRandomTitle());
  const [userToUnfollow, setUserToUnfollow] = useState<UserData | null>(null);
  const [viewType, setViewType] = useState<"grid" | "list">("list");

  const handleUnfollow = (user: UserData) => setUserToUnfollow(user);
  const handleCloseDialog = () => setUserToUnfollow(null);

  if (isLoading) {
    return <FriendsSkeleton isCollapsed={isCollapsed} />;
  }

  const friendCount = followedUsers?.length ?? 0;
  const showScrollArea = friendCount > 10;

  const getContentHeight = () => {
    if (showScrollArea) {
      return "calc(100vh - 300px)";
    }
    const baseHeight = 64;
    const itemHeight = viewType === "grid" ? 100 : 56;
    const gap = 12;
    const rows =
      viewType === "grid" ? Math.ceil((friendCount || 0) / 2) : friendCount;
    return `${baseHeight + (rows * itemHeight) + (rows - 1) * gap}px`;
  };

  return (
    <>
      <Card
        className={`bg-card/80 backdrop-blur-xs transition-all duration-300 ease-in-out ${
          isCollapsed ? "w-12 overflow-hidden" : "w-full"
        }`}
      >
        <CardContent
          className={`transition-all duration-300 ${
            isCollapsed ? "flex justify-center p-2" : "p-4"
          }`}
        >
          {isCollapsed ? (
            <Users className="h-6 w-6 text-muted-foreground" />
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center">
                  <CardTitle className="font-semibold text-muted-foreground text-sm uppercase">
                    {title}
                  </CardTitle>
                  {friendCount > 0 && (
                    <div className="flex items-center">
                      <div className="mx-2 h-1 w-1 rounded-full bg-muted-foreground/25" />
                      <span className="inline-flex h-5 items-center justify-center rounded-full bg-muted/30 px-2 font-medium text-muted-foreground/70 text-xs">
                        {friendCount}
                      </span>
                    </div>
                  )}
                </div>

                <ViewSwitcher onChange={setViewType} view={viewType} />
              </div>

              <div
                className="transition-all duration-300"
                style={{ height: getContentHeight() }}
              >
                {showScrollArea ? (
                  <ScrollArea className="h-full pr-4">
                    <FriendsList
                      followedUsers={followedUsers || []}
                      onUnfollow={handleUnfollow}
                      viewType={viewType}
                    />
                  </ScrollArea>
                ) : (
                  <FriendsList
                    followedUsers={followedUsers || []}
                    onUnfollow={handleUnfollow}
                    viewType={viewType}
                  />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {userToUnfollow && (
        <UnfollowUserDialog
          onClose={handleCloseDialog}
          open={!!userToUnfollow}
          user={userToUnfollow}
        />
      )}
    </>
  );
};

export default Friends;
