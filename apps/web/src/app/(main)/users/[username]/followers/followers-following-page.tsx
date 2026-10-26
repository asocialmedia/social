"use client";

import type { UserData } from "@asm/db";
import type { ProfileUserListData } from "@asm/ui/lib/user-list";
import { Input } from "@asm/ui/shadui/input";
import { Separator } from "@asm/ui/shadui/separator";
import { Tabs, TabsList } from "@asm/ui/shadui/tabs";
import noFollowImage from "@assets/general/nofollow.png";
import { useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useRef, useState } from "react";

import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import { ProfileUserListSkeleton } from "@/components/layouts/skeletons/profile-user-list-skeleton";
import FollowButton from "@/components/layouts/user/follow-button";
import UserAvatar from "@/components/layouts/user/user-avatar";
import PostHistoryCard from "@/components/posts/views/post-history-card";
import { ProfileListAvatar } from "@/components/profile/profile-list-avatar";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { ExternalFollowButton } from "@/components/protocols/external-follow-button";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import kyInstance from "@/lib/ky";

type ListTab = "followers" | "following";
const TABS = ["followers", "following"] as const;

const FollowersFollowingPage: React.FC<{
  loggedInUserData: UserData;
  userData: UserData;
}> = ({ userData, loggedInUserData }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const activeTab: ListTab =
    searchParams.get("tab") === "following" ? "following" : "followers";
  const results = useQueries({
    queries: TABS.map((tab) => ({
      queryFn: () =>
        kyInstance
          .get(`/api/users/${userData.id}/${tab}-list`)
          .json<ProfileUserListData[]>(),
      queryKey: ["profile-user-list", loggedInUserData.id, userData.id, tab],
      staleTime: 60_000,
    })),
  });
  const result = results[activeTab === "followers" ? 0 : 1];
  const search = query.trim().replace(/^@/, "").toLowerCase();
  const users = (result.data ?? []).filter(
    (user) =>
      !search ||
      `${user.displayName ?? ""} ${user.username}`
        .toLowerCase()
        .includes(search)
  );
  const handleTabChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === "following") {
        next.set("tab", "following");
      } else {
        next.delete("tab");
      }
      const queryString = next.toString();
      window.history.replaceState(
        null,
        "",
        queryString ? `${pathname}?${queryString}` : pathname
      );
      feedScrollRef.current?.scrollTo({ top: 0 });
    },
    [pathname, searchParams]
  );
  const navigateTab = useCallback(
    (direction: -1 | 1) => {
      if (
        (activeTab === "followers" && direction === 1) ||
        (activeTab === "following" && direction === -1)
      ) {
        handleTabChange(activeTab === "followers" ? "following" : "followers");
      }
    },
    [activeTab, handleTabChange]
  );
  useFeedSwipeNavigation(feedScrollRef, navigateTab);

  const emptyTitle = query.trim()
    ? "No matching people"
    : { followers: "No followers yet", following: "Not following anyone yet" }[
        activeTab
      ];
  const emptyMessage = query.trim()
    ? "Try another name or username."
    : {
        followers: "People who follow this profile will show up here.",
        following: "People this profile follows will show up here.",
      }[activeTab];
  let body: React.ReactNode;
  if (result.isPending) {
    body = <ProfileUserListSkeleton />;
  } else if (result.isError && !result.data) {
    body = (
      <div className="space-y-3 px-4 py-10 text-center">
        <p>Couldn't load this list.</p>
        <button
          className="btn-3d-gray rounded-full px-4 py-2"
          onClick={() => {
            void result.refetch();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  } else if (users.length) {
    body = (
      <div>
        {users.map((user, index) => (
          <div key={user.id}>
            {index > 0 ? <Separator className="bg-border/60" /> : null}
            <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[hsl(var(--muted))]">
              <Link
                className="shrink-0"
                href={user.href ?? `/users/${user.username}`}
              >
                <ProfileListAvatar user={user} />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  className="block truncate text-sm font-medium hover:underline"
                  href={user.href ?? `/users/${user.username}`}
                >
                  {user.displayName || user.username}
                  {user.source === "bluesky" ? (
                    <BlueskyIcon
                      tooltip={false}
                      className="ml-1 inline size-3"
                    />
                  ) : null}
                </Link>
                <span className="text-muted-foreground block truncate text-xs">
                  @{user.username}
                </span>
                {user.mutualCount > 0 ? (
                  <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]">
                    <span className="flex -space-x-1.5">
                      {user.mutualFollowers.map((mutual) => (
                        <UserAvatar
                          key={mutual.id}
                          avatarUrl={mutual.avatarUrl}
                          className="ring-background size-4.5 ring-2"
                          seed={mutual.id}
                          size={18}
                        />
                      ))}
                    </span>
                    <span>
                      {user.mutualCount}{" "}
                      {user.mutualCount === 1 ? "mutual" : "mutuals"}
                    </span>
                  </div>
                ) : null}
              </div>
              {user.source === "bluesky" ? (
                <ExternalFollowButton
                  did={user.id}
                  initialFollowing={user.isFollowing}
                  className="h-8 shrink-0 px-3 text-xs"
                />
              ) : (
                user.id !== loggedInUserData.id && (
                  <FollowButton
                    className="h-8 shrink-0 px-3 text-xs"
                    initialState={{
                      followers: user._count.followers,
                      isFollowedByUser: user.isFollowing,
                    }}
                    userId={user.id}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noFollowImage}
          width={1536}
        />
        <p className="font-medium">{emptyTitle}</p>
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
          <MobileTopBar backHref={`/users/${userData.username}`} />
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="border-border/60 border-b py-1.5">
              <TabsList className="flex h-full w-full justify-center gap-0 bg-transparent p-0">
                <AnimatedTabTrigger
                  active={activeTab === "followers"}
                  layoutId="user-list-tab-indicator"
                  value="followers"
                >
                  Followers
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={activeTab === "following"}
                  layoutId="user-list-tab-indicator"
                  value="following"
                >
                  Following
                </AnimatedTabTrigger>
              </TabsList>
            </div>
          </Tabs>
          <div className="px-4 py-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id="user-list-search"
                aria-label="Search followers and following"
                placeholder="Search by name or username…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            ref={feedScrollRef}
            className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto pb-24"
          >
            {body}
          </div>
          <FeedScrollbar containerRef={feedScrollRef} />
        </div>
      </div>
      <aside className="hide-native-scrollbar sticky top-0 hidden h-screen w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--background-alt))] p-3 lg:flex">
        <PostHistoryCard />
        <TrendingTopics />
      </aside>
      <MobileBottomNav />
    </>
  );
};
export default FollowersFollowingPage;
