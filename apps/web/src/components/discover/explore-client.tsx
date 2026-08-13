"use client";

import type { PostData } from "@asm/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useMemo, useRef } from "react";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import kyInstance from "@/lib/ky";
import ExploreMasonrySkeleton from "./explore-masonry-skeleton";
import ExplorePostCard from "./explore-post-card";
import ExploreUserCard, { type ExploreUser } from "./explore-user-card";

type ExploreTab = "for-you" | "trending";

const TAB_META: Record<ExploreTab, string> = {
  "for-you": "For you",
  trending: "Trending",
};

interface FeedData {
  posts: PostData[];
  users: ExploreUser[];
}

const USER_INTERVAL = 6;

const ExploreClient: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const tabParam = searchParams.get("tab");
  const activeTab: ExploreTab =
    tabParam === "trending" ? "trending" : "for-you";

  const handleTabChange = useCallback(
    (tab: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (tab === "for-you") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", tab);
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const queryKey = useMemo(() => ["explore-feed", activeTab], [activeTab]);

  const { data, status } = useQuery({
    queryKey,
    queryFn: async () => {
      const [posts, users] = await Promise.all([
        kyInstance.get(`/api/posts/${activeTab}`).json<{ posts: PostData[] }>(),
        kyInstance
          .get(
            `/api/users/${activeTab === "for-you" ? "suggested" : "trending"}`
          )
          .json<ExploreUser[]>(),
      ]);
      return { posts: posts.posts, users } satisfies FeedData;
    },
    staleTime: 60 * 1000,
  });

  const posts = data?.posts ?? [];
  const users = data?.users ?? [];

  const handleFollowed = useCallback(
    (userId: string) => {
      queryClient.setQueryData<FeedData>(queryKey, (old) =>
        old
          ? { ...old, users: old.users.filter((user) => user.id !== userId) }
          : old
      );
    },
    [queryClient, queryKey]
  );

  const handleTabClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const { tab } = e.currentTarget.dataset;
      if (tab) {
        handleTabChange(tab);
      }
    },
    [handleTabChange]
  );

  // Interleave user cards into the post stream (Pinterest-style).
  const items = useMemo(() => {
    const result: React.ReactNode[] = [];
    let postIndex = 0;
    let userIndex = 0;

    for (let slot = 0; postIndex < posts.length; slot += 1) {
      if (
        userIndex < users.length &&
        slot % USER_INTERVAL === USER_INTERVAL - 1
      ) {
        const user = users[userIndex];
        result.push(
          <ExploreUserCard
            key={`user-${user.id}`}
            onFollowed={handleFollowed}
            user={user}
          />
        );
        userIndex += 1;
      } else {
        const post = posts[postIndex];
        result.push(<ExplorePostCard key={`post-${post.id}`} post={post} />);
        postIndex += 1;
      }
    }

    while (userIndex < users.length) {
      const user = users[userIndex];
      result.push(
        <ExploreUserCard
          key={`user-${user.id}`}
          onFollowed={handleFollowed}
          user={user}
        />
      );
      userIndex += 1;
    }

    return result;
  }, [posts, users, handleFollowed]);

  let body: React.ReactNode;
  if (status === "pending") {
    body = <ExploreMasonrySkeleton />;
  } else if (status === "error") {
    body = (
      <p className="px-4 py-8 text-center text-destructive">
        An error occurred while loading content.
      </p>
    );
  } else if (items.length === 0) {
    body = (
      <p className="px-4 py-16 text-center text-muted-foreground">
        Nothing here yet.
      </p>
    );
  } else {
    body = (
      <div className="columns-2 gap-4 p-4 sm:columns-3 xl:columns-4">
        {items}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
        <div className="flex items-center border-border/60 border-b">
          {(Object.keys(TAB_META) as ExploreTab[]).map((tab) => (
            <button
              className={`${TAB_TRIGGER_CLASS} flex-1`}
              data-state={activeTab === tab ? "active" : "inactive"}
              data-tab={tab}
              key={tab}
              onClick={handleTabClick}
              type="button"
            >
              {TAB_META[tab]}
            </button>
          ))}
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
  );
};

export default ExploreClient;
