"use client";

import { useQuery } from "@tanstack/react-query";
import type { UserData } from "@asm/db";
import { useToast } from "@asm/ui/hooks/use-toast";
import { Card } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@asm/ui/shadui/tabs";
import { AtSignIcon, FileTextIcon } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useCallback, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorFallback } from "../misc/error-boundary";
import MentionedPosts from "./mentioned-posts";
import UserDetails from "./sidebars/right/user-details";
import UserPosts from "./user-post";

interface ReactErrorBoundaryFallbackProps {
  error: unknown;
  resetErrorBoundary: (...args: unknown[]) => void;
}

interface ProfileFeedViewProps {
  loggedInUserId: string;
  userData: UserData;
  username: string;
}

const ProfileFeedView: React.FC<ProfileFeedViewProps> = ({
  userData: initialUserData,
  loggedInUserId,
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("posts");

  const {
    data: userData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["user", initialUserData.id],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/users/${initialUserData.id}`);
        if (!response.ok) {
          throw new Error("Failed to fetch user data");
        }
        return response.json();
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
    retry: 2,
  });

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
  }, []);

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  if (error || !userData) {
    return <div>Error loading profile</div>;
  }

  return (
    <ErrorBoundary
      FallbackComponent={(props: ReactErrorBoundaryFallbackProps) => (
        <ErrorFallback
          error={props.error instanceof Error ? props.error : null}
          resetErrorBoundary={() => props.resetErrorBoundary()}
        />
      )}
    >
      <div className="flex-1 bg-background p-4 text-foreground md:p-8">
        <motion.main
          animate={{ opacity: 1 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="mt-2 mb-10 md:hidden">
            <UserDetails loggedInUserId={loggedInUserId} userData={userData} />
          </div>

          <div className="hidden md:block">
            <ProfileHeader userData={userData} />
          </div>

          <Card className="mb-8 overflow-hidden bg-card shadow-lg">
            <div className="p-4">
              <Tabs
                className="w-full"
                defaultValue="posts"
                onValueChange={handleTabChange}
                value={activeTab}
              >
                <div className="mb-6 flex justify-center">
                  <TabsList className="relative flex gap-2 rounded-full border bg-muted/30 p-0 shadow-inner shadow-white/5 ring-1 ring-white/10 backdrop-blur-xl dark:shadow-black/10 dark:ring-black/20">
                    <div
                      className="absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-primary/20 via-secondary/20 to-accent/20 opacity-30 blur-md"
                      style={{
                        background:
                          "radial-gradient(circle at top left, rgba(var(--primary-rgb), 0.15), transparent 70%), radial-gradient(circle at bottom right, rgba(var(--accent-rgb), 0.15), transparent 70%)",
                      }}
                    />
                    <TabsTrigger
                      className="group relative flex items-center gap-2 rounded-full px-5 py-2.5 font-medium text-sm transition-all duration-300 ease-out hover:bg-background/50 data-[state=active]:scale-105 data-[state=active]:text-primary"
                      value="posts"
                    >
                      <span className="absolute inset-0 rounded-full bg-background/0 shadow-none transition-all duration-300 group-data-[state=active]:bg-background group-data-[state=active]:shadow-md group-data-[state=active]:shadow-primary/10" />
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="relative">
                          <FileTextIcon className="h-4 w-4 transition-all duration-300 group-data-[state=active]:text-primary" />
                          <span className="absolute inset-0 rounded-full bg-primary/20 opacity-0 blur-xs transition-opacity group-hover:opacity-30 group-data-[state=active]:opacity-50" />
                        </span>
                        <span className="transition-all duration-300 group-data-[state=active]:font-semibold">
                          Posts
                        </span>
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      className="group relative flex items-center gap-2 rounded-full px-5 py-2.5 font-medium text-sm transition-all duration-300 ease-out hover:bg-background/50 data-[state=active]:scale-105 data-[state=active]:text-primary"
                      value="mentions"
                    >
                      <span className="absolute inset-0 rounded-full bg-background/0 shadow-none transition-all duration-300 group-data-[state=active]:bg-background group-data-[state=active]:shadow-md group-data-[state=active]:shadow-primary/10" />
                      <span className="relative z-10 flex items-center gap-2">
                        <span className="relative">
                          <AtSignIcon className="h-4 w-4 transition-all duration-300 group-data-[state=active]:text-primary" />
                          <span className="absolute inset-0 rounded-full bg-primary/20 opacity-0 blur-xs transition-opacity group-hover:opacity-30 group-data-[state=active]:opacity-50" />
                        </span>
                        <span className="transition-all duration-300 group-data-[state=active]:font-semibold">
                          Mentions
                        </span>
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent
                  className={activeTab === "posts" ? "block" : "hidden"}
                  value="posts"
                >
                  <motion.div
                    animate={{ opacity: 1 }}
                    initial={false}
                    key="posts-tab"
                    transition={{ duration: 0.3 }}
                  >
                    <UserPosts filter="all" userId={userData.id} />
                  </motion.div>
                </TabsContent>

                <TabsContent
                  className={activeTab === "mentions" ? "block" : "hidden"}
                  value="mentions"
                >
                  <motion.div
                    animate={{ opacity: 1 }}
                    initial={false}
                    key="mentions-tab"
                    transition={{ duration: 0.3 }}
                  >
                    <MentionedPosts userId={userData.id} />
                  </motion.div>
                </TabsContent>
              </Tabs>
            </div>
          </Card>

          <div className="mb-16 md:hidden">
            <ProfileHeader userData={userData} />
          </div>
        </motion.main>
      </div>
    </ErrorBoundary>
  );
};

export default ProfileFeedView;

const ProfileHeader: React.FC<{ userData: UserData }> = ({ userData }) => {
  const { data: avatarData } = useQuery({
    queryKey: ["avatar", userData?.id],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/users/avatar/${userData?.id}`);
        if (!response.ok) {
          throw new Error("Failed to fetch avatar");
        }
        return response.json();
      } catch {
        return {
          url: userData?.avatarUrl,
          key: userData?.avatarKey,
        };
      }
    },
    initialData: {
      url: userData?.avatarUrl,
      key: userData?.avatarKey,
    },
    enabled: !!userData?.id,
    staleTime: 1000 * 60 * 5,
  });

  if (!userData) {
    return null;
  }

  return (
    <Card className="mb-6 overflow-hidden">
      <motion.div
        animate={{ y: 0, opacity: 1 }}
        className="relative h-32"
        initial={{ y: -20, opacity: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <div className="absolute inset-0">
          <div
            className="h-full w-full bg-center bg-cover"
            style={{
              backgroundImage: avatarData?.url
                ? `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.1)), url(${avatarData.url})`
                : "none",
              filter: "blur(8px)",
              transform: "scale(1.1)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative flex h-full items-center justify-center px-4">
          <div className="text-center">
            <h1 className="font-bold text-2xl text-white uppercase drop-shadow-md">
              {userData.displayName}'s Profile
            </h1>
            <p className="mt-1 text-muted-foreground">
              You are viewing {userData.displayName}'s content
            </p>
          </div>
        </div>
      </motion.div>
    </Card>
  );
};

const ProfileSkeleton = () => (
  <div className="space-y-4 p-4">
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-20 w-full" />
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  </div>
);
