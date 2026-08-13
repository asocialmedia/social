"use client";

import type { HNStory as HnStoryType } from "@asm/aggregator/hackernews";
import type { PostsPage, UserData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import noBookmarksImage from "@assets/general/nonotibook.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart, Newspaper, Terminal } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useRef } from "react";
import BookmarksSidebar from "@/components/bookmarks/bookmarks-sidebar";
import { HNStoryCard } from "@/components/hackernews/hn-story-card";
import { FeedView } from "@/components/home/feed-view";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";
import LikedPosts from "./liked-posts";

interface HnBookmarksResponse {
  nextCursor: string | null;
  stories: HnStoryType[];
}

interface BookmarksProps {
  hnBookmarkCount: number;
  postBookmarkCount: number;
  userData: UserData;
}

const Bookmarks: React.FC<BookmarksProps> = ({
  hnBookmarkCount,
  postBookmarkCount,
  userData,
}) => {
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const {
    data: postsData,
    fetchNextPage: fetchNextPosts,
    hasNextPage: hasNextPosts,
    isFetching: isFetchingPosts,
    isFetchingNextPage: isFetchingNextPosts,
    status: postsStatus,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "bookmarks"],
    queryFn: async ({ pageParam }) => {
      const response = await kyInstance
        .get(
          "/api/posts/bookmarked",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>();
      return response;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const {
    data: hnData,
    fetchNextPage: fetchNextHn,
    hasNextPage: hasNextHn,
    isFetching: isFetchingHn,
    isFetchingNextPage: isFetchingNextHn,
    status: hnStatus,
  } = useInfiniteQuery({
    queryKey: ["hn-bookmarks"],
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `/api/hackernews/bookmarked${pageParam ? `?cursor=${pageParam}` : ""}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch HN bookmarks");
      }
      return (await response.json()) as HnBookmarksResponse;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
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

  const isLoading = postsStatus === "pending" || hnStatus === "pending";

  const showEmptyState =
    postsStatus === "success" &&
    hnStatus === "success" &&
    !posts.length &&
    !hnStories.length &&
    !hasNextPosts &&
    !hasNextHn;

  let feedBody: React.ReactNode;
  if (isLoading) {
    feedBody = <FeedViewSkeleton />;
  } else if (postsStatus === "error" && hnStatus === "error") {
    feedBody = (
      <p className="px-4 py-8 text-center text-destructive">
        An error occurred while loading bookmarks.
      </p>
    );
  } else if (showEmptyState) {
    feedBody = (
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
          Bookmark posts and HackerNews stories to read them later.
        </p>
      </div>
    );
  } else {
    feedBody = (
      <>
        <TabsContent className="mt-0 pb-12" value="posts">
          <InfiniteScrollContainer onBottomReached={handleBottomReachedPosts}>
            {posts.length > 0 ? (
              <FeedView cacheKey={["post-feed", "bookmarks"]} posts={posts} />
            ) : null}
            {isFetchingNextPosts ? <LoadMoreSkeleton /> : null}
          </InfiniteScrollContainer>
        </TabsContent>

        <TabsContent className="mt-0 pb-12" value="hackernews">
          <InfiniteScrollContainer onBottomReached={handleBottomReachedHn}>
            <div className="flex flex-col">
              {hnStories.map((story, index) => (
                <div key={story.id}>
                  {index > 0 && <Separator className="bg-border/60" />}
                  <HNStoryCard initialBookmarked={true} story={story} />
                </div>
              ))}
            </div>
            {isFetchingNextHn ? <LoadMoreSkeleton /> : null}
          </InfiniteScrollContainer>
        </TabsContent>

        <TabsContent className="mt-0 pb-12" value="likes">
          <LikedPosts />
        </TabsContent>
      </>
    );
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue="posts">
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="relative flex items-center border-border/60 border-b py-1.5">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="posts">
                  <Newspaper className="mr-2 h-4 w-4" />
                  Posts
                  {postBookmarkCount > 0 ? (
                    <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/50 font-semibold text-[10px] text-muted-foreground tabular-nums">
                      {postBookmarkCount}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="hackernews">
                  <Terminal className="mr-2 h-4 w-4" />
                  HackerNews
                  {hnBookmarkCount > 0 ? (
                    <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/50 font-semibold text-[10px] text-muted-foreground tabular-nums">
                      {hnBookmarkCount}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="likes">
                  <Heart className="mr-2 h-4 w-4" />
                  Likes
                </TabsTrigger>
              </TabsList>
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex">
                <div className="w-full max-w-[24rem] xl:max-w-md">
                  <SearchField />
                </div>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
              ref={feedScrollRef}
            >
              {feedBody}
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>

      <BookmarksSidebar
        hnBookmarkCount={hnBookmarkCount}
        postBookmarkCount={postBookmarkCount}
      />
      <MobileBottomNav />
    </div>
  );
};

export default Bookmarks;
