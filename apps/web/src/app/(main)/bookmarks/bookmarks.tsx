"use client";

import type { HNStory as HnStoryType } from "@asm/aggregator/hackernews";
import type { PostData, PostsPage, UserData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import noBookmarksImage from "@assets/general/nonotibook.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import type React from "react";
import { useCallback, useRef, useState } from "react";

import BookmarksSidebar from "@/components/bookmarks/bookmarks-sidebar";
import { HNStoryCard } from "@/components/hackernews/hn-story-card";
import { FeedView } from "@/components/home/feed-view";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/navigation/search-field";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import { useBookmarkCount } from "@/hooks/posts/use-bookmark-count";
import kyInstance from "@/lib/ky";

import BookmarkedGusts from "./bookmarked-gusts";
import LikedPosts from "./liked-posts";

interface HnBookmarksResponse {
  nextCursor: string | null;
  stories: HnStoryType[];
}

interface BookmarksProps {
  gustBookmarkCount: number;
  hnBookmarkCount: number;
  postBookmarkCount: number;
  userData: UserData;
}

// Swipe order mirrors the rendered tab strip order.
const TAB_ORDER = ["posts", "gusts", "hackernews", "likes"];

function FleetsTabBody({
  isFetchingNext,
  onBottomReached,
  posts,
  status,
}: {
  isFetchingNext: boolean;
  onBottomReached: () => void;
  posts: PostData[];
  status: "error" | "pending" | "success";
}) {
  if (status === "pending") {
    return <FeedViewSkeleton />;
  }
  if (status === "error") {
    return (
      <p className="text-destructive px-4 py-8 text-center">
        An error occurred while loading bookmarked fleets.
      </p>
    );
  }
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noBookmarksImage}
          width={1536}
        />
        <p className="font-medium">You don&apos;t have any bookmarks yet.</p>
        <p className="text-muted-foreground text-sm">
          Bookmark fleets to read them later.
        </p>
      </div>
    );
  }
  return (
    <InfiniteScrollContainer onBottomReached={onBottomReached}>
      <FeedView cacheKey={["post-feed", "bookmarks"]} posts={posts} />
      {isFetchingNext ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}

function HackerNewsTabBody({
  isFetchingNext,
  onBottomReached,
  status,
  stories,
}: {
  isFetchingNext: boolean;
  onBottomReached: () => void;
  status: "error" | "pending" | "success";
  stories: HnStoryType[];
}) {
  if (status === "pending") {
    return <FeedViewSkeleton />;
  }
  if (status === "error") {
    return (
      <p className="text-destructive px-4 py-8 text-center">
        An error occurred while loading HackerNews bookmarks.
      </p>
    );
  }
  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noBookmarksImage}
          width={1536}
        />
        <p className="font-medium">No bookmarked HackerNews stories.</p>
        <p className="text-muted-foreground text-sm">
          Bookmark HackerNews stories to read them later.
        </p>
      </div>
    );
  }
  return (
    <InfiniteScrollContainer onBottomReached={onBottomReached}>
      <div className="flex flex-col">
        {stories.map((story, index) => (
          <div key={story.id}>
            {index > 0 && <Separator className="bg-border/60" />}
            <HNStoryCard initialBookmarked={true} story={story} />
          </div>
        ))}
      </div>
      {isFetchingNext ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}

const Bookmarks: React.FC<BookmarksProps> = ({
  gustBookmarkCount,
  hnBookmarkCount,
  postBookmarkCount,
  userData,
}) => {
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState("posts");

  // Mobile swipes drag the tab strip like a carousel (same mechanism as the
  // home feed).
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = TAB_ORDER.indexOf(activeTab) + direction;
      if (nextIndex >= 0 && nextIndex < TAB_ORDER.length) {
        setActiveTab(TAB_ORDER[nextIndex]);
      }
    },
    [activeTab]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate);

  // Server props seed the cache; optimistic bookmark toggles + invalidation
  // keep the tab badges and sidebar tiles live without a reload.
  const { data: liveCounts } = useBookmarkCount({
    gustCount: gustBookmarkCount,
    hnCount: hnBookmarkCount,
    postCount: postBookmarkCount,
    totalCount: postBookmarkCount + hnBookmarkCount,
  });
  const postsTabCount = liveCounts?.postCount ?? postBookmarkCount;
  const gustTabCount = liveCounts?.gustCount ?? gustBookmarkCount;
  const hnTabCount = liveCounts?.hnCount ?? hnBookmarkCount;

  const {
    data: postsData,
    fetchNextPage: fetchNextPosts,
    hasNextPage: hasNextPosts,
    isFetching: isFetchingPosts,
    isFetchingNextPage: isFetchingNextPosts,
    status: postsStatus,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const response = await kyInstance
        .get(
          "/api/posts/bookmarked",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>();
      return response;
    },
    queryKey: ["post-feed", "bookmarks"],
  });

  const {
    data: hnData,
    fetchNextPage: fetchNextHn,
    hasNextPage: hasNextHn,
    isFetching: isFetchingHn,
    isFetchingNextPage: isFetchingNextHn,
    status: hnStatus,
  } = useInfiniteQuery({
    enabled: activeTab === "hackernews",
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const response = await fetch(
        `/api/hackernews/bookmarked${pageParam ? `?cursor=${pageParam}` : ""}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch HN bookmarks");
      }
      return (await response.json()) as HnBookmarksResponse;
    },
    queryKey: ["hn-bookmarks"],
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const posts = (postsData?.pages.flatMap((page) => page.posts) || []).filter(
    Boolean
  );
  const hnStories =
    (hnData?.pages.flatMap((page) => page.stories) || []).filter(Boolean) || [];

  const handleBottomReachedPosts = useCallback(() => {
    if (hasNextPosts && !isFetchingPosts) {
      fetchNextPosts();
    }
  }, [fetchNextPosts, hasNextPosts, isFetchingPosts]);

  const handleBottomReachedHn = useCallback(() => {
    if (hasNextHn && !isFetchingHn) {
      fetchNextHn();
    }
  }, [fetchNextHn, hasNextHn, isFetchingHn]);

  if (!userData) {
    return null;
  }

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={setActiveTab}
          value={activeTab}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="border-border/60 relative flex items-center border-b py-1.5">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
                <AnimatedTabTrigger
                  active={activeTab === "posts"}
                  layoutId="bookmarks-tab-indicator"
                  value="posts"
                >
                  <span className="whitespace-nowrap">Fleets</span>
                  {postsTabCount > 0 ? (
                    <span className="border-border/60 bg-muted/50 text-muted-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums">
                      {postsTabCount}
                    </span>
                  ) : null}
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={activeTab === "gusts"}
                  layoutId="bookmarks-tab-indicator"
                  value="gusts"
                >
                  <span className="whitespace-nowrap">Gusts</span>
                  {gustTabCount > 0 ? (
                    <span className="border-border/60 bg-muted/50 text-muted-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums">
                      {gustTabCount}
                    </span>
                  ) : null}
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={activeTab === "hackernews"}
                  layoutId="bookmarks-tab-indicator"
                  value="hackernews"
                >
                  <span className="whitespace-nowrap">HackerNews</span>
                  {hnTabCount > 0 ? (
                    <span className="border-border/60 bg-muted/50 text-muted-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums">
                      {hnTabCount}
                    </span>
                  ) : null}
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={activeTab === "likes"}
                  layoutId="bookmarks-tab-indicator"
                  value="likes"
                >
                  <span className="whitespace-nowrap">Likes</span>
                </AnimatedTabTrigger>
              </TabsList>
              {/* xl:hidden: the bookmarks sidebar owns the search bar from xl
                  up; this header copy serves the md-xl gap. */}
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex xl:hidden">
                <div className="w-full max-w-[24rem] xl:max-w-md">
                  <SearchField />
                </div>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full touch-pan-y overflow-x-hidden overflow-y-auto"
              ref={feedScrollRef}
            >
              <TabsContent className="mt-0 pb-12" value="posts">
                <FleetsTabBody
                  isFetchingNext={isFetchingNextPosts}
                  onBottomReached={handleBottomReachedPosts}
                  posts={posts}
                  status={postsStatus}
                />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="gusts">
                <BookmarkedGusts />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="hackernews">
                <HackerNewsTabBody
                  isFetchingNext={isFetchingNextHn}
                  onBottomReached={handleBottomReachedHn}
                  status={hnStatus}
                  stories={hnStories}
                />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="likes">
                <LikedPosts />
              </TabsContent>
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>

      <BookmarksSidebar
        gustBookmarkCount={gustTabCount}
        hnBookmarkCount={hnTabCount}
        postBookmarkCount={postsTabCount}
      />
      <MobileBottomNav />
    </>
  );
};

export default Bookmarks;
