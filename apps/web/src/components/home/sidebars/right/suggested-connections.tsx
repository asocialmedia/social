"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "@asm/ui/hooks/use-toast";
import { Button } from "@asm/ui/shadui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@asm/ui/shadui/card";
import { RefreshCw, UserRound, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";
import FollowButton, {
  preloadFollowButton,
} from "@/components/layouts/follow-button";
import SuggestedConnectionsSkeleton from "@/components/layouts/skeletons/sc-skeleton";
import UserAvatar from "@/components/layouts/user-avatar";
import UserTooltip from "@/components/layouts/user-tooltip";
import { getSuggestedConnections } from "./user-actions";

interface SerializableUserData {
  _count: {
    followers: number;
  };
  aura: number;
  avatarUrl: string | null;
  bio?: string;
  displayName: string;
  followers: { followerId: string }[];
  followState: {
    followers: number;
    isFollowedByUser: false;
  };
  id: string;
  username: string;
}

const SuggestedConnections: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    preloadFollowButton();
  }, []);

  const {
    data: connections,
    isLoading,
    error,
    refetch,
  } = useQuery<SerializableUserData[]>({
    queryKey: ["suggested-connections"],
    queryFn: async () => {
      const result = await getSuggestedConnections();
      if (result instanceof Error) {
        throw result;
      }

      const followStates = await fetch("/api/users/follow-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: result.map((user: { id: string }) => user.id),
        }),
      }).then((r) => r.json());

      return result.map((user: { id: string | number }) => ({
        ...user,
        followState: followStates[user.id],
      }));
    },
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: 1000,
  });

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await refetch();
      toast({
        title: "Refreshed",
        description: "Suggestions have been updated.",
        duration: 3000,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to refresh suggestions. Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return <SuggestedConnectionsSkeleton />;
  }

  if (error) {
    return (
      <Card className="bg-card shadow-md">
        <CardHeader>
          <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wider">
            Suggested Connections
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-6 text-center">
            <UserRound className="mx-auto mb-3 h-12 w-12 text-muted-foreground/20" />
            <p className="text-muted-foreground text-sm">
              Unable to load suggestions.
            </p>
            <p className="text-muted-foreground/60 text-xs">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <Button
              className="mt-4"
              onClick={() => refetch()}
              size="sm"
              variant="outline"
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card shadow-md">
      <CardHeader className="border-border/10 border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
          <Users className="h-3 w-3" />
          Suggested Connections
          <span className="text-[11px] text-muted-foreground/60">
            ({connections?.length ?? 0})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        <AnimatePresence mode="wait">
          {connections && connections.length > 0 ? (
            <motion.ul
              animate={{ opacity: 1 }}
              className="space-y-1"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
            >
              {connections.map((connection, index) => (
                <motion.li
                  animate={{ opacity: 1, y: 0 }}
                  className="group flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-accent/5"
                  exit={{ opacity: 0, y: -10 }}
                  initial={{ opacity: 0, y: 10 }}
                  key={connection.id}
                  transition={{ delay: index * 0.05 }}
                >
                  {/* @ts-expect-error */}
                  <UserTooltip user={connection}>
                    <div className="flex min-w-0 flex-1 items-center space-x-2">
                      <Link href={`/users/${connection.username}`}>
                        <UserAvatar
                          avatarUrl={connection.avatarUrl}
                          className="transition-transform duration-200 hover:scale-105"
                          size={28}
                        />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link href={`/users/${connection.username}`}>
                          <div className="flex flex-col leading-tight">
                            <p className="max-w-30 truncate font-medium text-foreground text-sm transition-colors hover:text-primary">
                              {connection.displayName}
                            </p>
                            <div className="flex items-center gap-1">
                              <p className="max-w-30 truncate text-[11px] text-muted-foreground hover:text-muted-foreground/80">
                                @{connection.username}
                              </p>
                              {connection.aura > 0 && (
                                <span className="flex items-center text-[10px] text-orange-500">
                                  • {connection.aura} 🔥
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      </div>
                    </div>
                  </UserTooltip>
                  <FollowButton
                    className="opacity-80 transition-opacity group-hover:opacity-100"
                    initialState={
                      connection.followState || {
                        followers: connection._count.followers,
                        isFollowedByUser: false,
                      }
                    }
                    userId={connection.id}
                  />
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <motion.div
              animate={{ opacity: 1 }}
              className="py-3 text-center"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
            >
              <UserRound className="mx-auto mb-2 h-8 w-8 text-muted-foreground/20" />
              <p className="text-muted-foreground text-xs">
                No suggestions available.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
      <CardFooter className="border-border/10 border-t p-2">
        <Button
          className="h-7 w-full text-[11px] text-muted-foreground hover:text-primary"
          disabled={isRefreshing}
          onClick={handleRefresh}
          size="sm"
          variant="ghost"
        >
          <RefreshCw
            className={`mr-1.5 h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </CardFooter>
    </Card>
  );
};

SuggestedConnections.displayName = "SuggestedConnections";

export default SuggestedConnections;
