"use client";

import type { UserData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import noFollowImage from "@assets/general/nofollow.png";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useRef } from "react";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import FollowButton from "@/components/layouts/follow-button";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import UserAvatar from "@/components/layouts/user-avatar";
import PostHistoryCard from "@/components/posts/post-history-card";
import kyInstance from "@/lib/ky";

interface UserListItem {
  _count: {
    followers: number;
  };
  avatarUrl: string | null;
  bio: string | null;
  displayName: string;
  id: string;
  isFollowing: boolean;
  username: string;
}

type ListTab = "followers" | "following";

interface FollowersFollowingPageProps {
  loggedInUserData: UserData;
  userData: UserData;
}

const FollowersFollowingPage: React.FC<FollowersFollowingPageProps> = ({
  loggedInUserData,
  userData,
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const tabParam = searchParams.get("tab");
  const activeTab: ListTab =
    tabParam === "following" ? "following" : "followers";

  const { data, status } = useQuery({
    queryKey: [
      activeTab === "followers" ? "followers-list" : "following-list",
      userData.id,
    ],
    queryFn: () =>
      kyInstance
        .get(
          `/api/users/${userData.id}/${activeTab === "followers" ? "followers-list" : "following-list"}`
        )
        .json<UserListItem[]>(),
    staleTime: 60 * 1000,
  });

  const users = data ?? [];

  const handleTabChange = useCallback(
    (tab: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (tab === "following") {
        nextParams.set("tab", "following");
      } else {
        nextParams.delete("tab");
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const handleGoBack = useCallback(() => {
    router.push(`/users/${userData.username}`);
  }, [router, userData.username]);

  const handleTabClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const { tab } = e.currentTarget.dataset;
      if (tab) {
        handleTabChange(tab);
      }
    },
    [handleTabChange]
  );

  let body: React.ReactNode;
  if (status === "pending") {
    body = (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (users.length === 0) {
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
        <p className="font-medium">
          {activeTab === "followers"
            ? "No followers yet"
            : "Not following anyone yet"}
        </p>
        <p className="text-muted-foreground text-sm">
          {activeTab === "followers"
            ? "People who follow this profile will show up here."
            : "People this profile follows will show up here."}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col">
        {users.map((user, index) => (
          <div key={user.id}>
            {index > 0 && <Separator className="bg-border/60" />}
            <div className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
              <Link className="shrink-0" href={`/users/${user.username}`}>
                <UserAvatar avatarUrl={user.avatarUrl} className="h-11 w-11" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  className="block truncate font-medium text-sm hover:underline"
                  href={`/users/${user.username}`}
                >
                  {user.displayName}
                </Link>
                <span className="block truncate text-muted-foreground text-xs">
                  @{user.username}
                </span>
                {user.bio ? (
                  <span className="mt-0.5 line-clamp-1 block text-muted-foreground text-xs">
                    {user.bio}
                  </span>
                ) : null}
              </div>
              <FollowButton
                className="h-8 shrink-0 px-3 text-xs"
                initialState={{
                  followers: user._count.followers,
                  isFollowedByUser: user.isFollowing,
                }}
                userId={user.id}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={loggedInUserData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
          <MobileTopBar />
          <div className="flex shrink-0 items-center gap-2 border-border/60 border-b bg-[hsl(var(--background-alt))] px-3 py-2">
            <button
              aria-label="Go back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 active:translate-y-px"
              onClick={handleGoBack}
              type="button"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-semibold text-lg leading-tight">
                {userData.displayName || userData.username}
              </h1>
              <p className="truncate text-muted-foreground text-xs">
                @{userData.username}
              </p>
            </div>
          </div>
          <div className="flex items-center border-border/60 border-b">
            <button
              className={`${TAB_TRIGGER_CLASS} flex-1`}
              data-state={activeTab === "followers" ? "active" : "inactive"}
              data-tab="followers"
              onClick={handleTabClick}
              type="button"
            >
              Followers
            </button>
            <button
              className={`${TAB_TRIGGER_CLASS} flex-1`}
              data-state={activeTab === "following" ? "active" : "inactive"}
              data-tab="following"
              onClick={handleTabClick}
              type="button"
            >
              Following
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
            ref={feedScrollRef}
          >
            {body}
          </div>
          <FeedScrollbar containerRef={feedScrollRef} />
        </div>
      </div>

      <aside className="hide-native-scrollbar sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-border/60 border-l px-5 pt-2.5 pb-6 xl:flex">
        <div className="flex flex-col gap-4">
          <PostHistoryCard />
          <TrendingTopics />
        </div>
      </aside>

      <MobileBottomNav />
    </div>
  );
};

export default FollowersFollowingPage;
