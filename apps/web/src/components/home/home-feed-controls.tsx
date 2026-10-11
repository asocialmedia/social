"use client";

import type { PostsPage } from "@asm/db";
import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";
import {
  discoveryFeedPress,
  followingFleetAvatars,
} from "@asm/ui/lib/home-feed-controls";
import type { DiscoveryFleetFeed } from "@asm/ui/lib/home-feed-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { TabsList } from "@asm/ui/shadui/tabs";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { ChevronDown, Flame, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import UserAvatar from "@/components/layouts/user/user-avatar";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";
import type { HomeTab } from "@/store/tab-store";

function FollowingAvatars({ userId }: { userId: string }) {
  const reducedMotion = useReducedMotion();
  const { data: feed } = useQuery<InfiniteData<PostsPage>>({
    enabled: false,
    queryFn: skipToken,
    queryKey: ["post-feed", "following", userId],
  });
  const { data: people } = useQuery({
    queryFn: () =>
      kyInstance
        .get(`/api/users/${encodeURIComponent(userId)}/following-list`)
        .json<GustFollowingAvatar[]>(),
    queryKey: ["gust-header-following-people", userId],
    staleTime: 60_000,
  });
  const avatars = followingFleetAvatars(
    feed?.pages.flatMap((page) => page.posts) ?? [],
    people ?? []
  );
  return (
    <span aria-hidden className="ml-1 flex -space-x-2">
      {avatars.map((person, index) => (
        <motion.span
          key={person.id}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: reducedMotion ? 0 : index * 0.035,
            duration: 0.18,
            ease: "easeOut",
          }}
          className="ring-background rounded-md ring-1"
          style={{ zIndex: 3 - index }}
        >
          <UserAvatar
            avatarUrl={person.avatarUrl}
            className="rounded-md!"
            seed={person.id}
            size={22}
          />
        </motion.span>
      ))}
    </span>
  );
}

export function HomeFeedControls({
  active,
  discovery,
  onChange,
  userId,
}: {
  active: HomeTab;
  discovery: DiscoveryFleetFeed;
  onChange: (tab: HomeTab) => void;
  userId?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="flex flex-1 items-center justify-center font-sans md:hidden"
      data-home-feed-controls
    >
      <DropdownMenu
        open={menuOpen && active === discovery}
        onOpenChange={(open) => {
          const action = discoveryFeedPress(active, discovery);
          if (open && action.type === "navigate") {
            setMenuOpen(false);
            onChange(action.feed);
          } else {
            setMenuOpen(open);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${discovery === "personalized" ? "For you" : "Trending"}, choose Fleets feed`}
            className={cn(
              "relative flex min-h-11 items-center gap-1 px-3 text-sm",
              active === discovery
                ? "text-foreground font-semibold"
                : "text-muted-foreground font-medium"
            )}
          >
            {discovery === "personalized" ? "For you" : "Trending"}
            <ChevronDown className="size-3.5" />
            {active === discovery ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]"
              />
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-32 p-1.5 font-sans">
          {(["personalized", "trending"] as const)
            .filter((value) => value !== discovery)
            .map((value) => {
              const Icon = value === "personalized" ? Sparkles : Flame;
              return (
                <DropdownMenuItem
                  key={value}
                  className="pill-3d-hover gap-3 rounded-md px-2 py-2"
                  onSelect={() => {
                    setMenuOpen(false);
                    onChange(value);
                  }}
                >
                  <Icon className="size-4" fill="currentColor" />
                  {value === "personalized" ? "For you" : "Trending"}
                </DropdownMenuItem>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>
      <TabsList className="flex h-full items-center gap-0 bg-transparent p-0">
        <AnimatedTabTrigger
          active={active === "latest"}
          className="data-[state=active]:px-3"
          layoutId="home-mobile-tab-indicator"
          value="latest"
        >
          Latest
        </AnimatedTabTrigger>
        <AnimatedTabTrigger
          active={active === "following"}
          className="data-[state=active]:px-3"
          layoutId="home-mobile-tab-indicator"
          value="following"
          indicatorClassName="w-[60%] min-w-12"
        >
          Following
          {active === "following" && userId ? (
            <FollowingAvatars key={userId} userId={userId} />
          ) : null}
        </AnimatedTabTrigger>
      </TabsList>
    </div>
  );
}
