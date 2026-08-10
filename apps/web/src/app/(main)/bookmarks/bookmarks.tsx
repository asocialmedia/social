"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { HNStory as HnStoryType } from "@asm/aggregator/hackernews";
import type { PostsPage } from "@asm/db";
import { HNStory } from "@asm/ui/components/hackernews";
import { Card } from "@asm/ui/shadui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@asm/ui/shadui/tabs";
import { Newspaper, Terminal } from "lucide-react";
import { motion } from "motion/react";
import Post from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import PostsOnlyLoadingSkeleton from "@/components/layouts/skeletons/post-only-loading-skeleton";
import kyInstance from "@/lib/ky";

interface HnBookmarksResponse {
  nextCursor: string | null;
  stories: HnStoryType[];
}

const tabVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Bookmarks() {
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
  const hnStories = hnData?.pages.flatMap((page) => page.stories) || [];

  if (postsStatus === "pending" || hnStatus === "pending") {
    return <PostsOnlyLoadingSkeleton />;
  }

  if (postsStatus === "error" && hnStatus === "error") {
    return (
      <p className="text-center text-destructive">
        An error occurred while loading bookmarks.
      </p>
    );
  }

  const showEmptyState =
    postsStatus === "success" &&
    hnStatus === "success" &&
    !posts.length &&
    !hnStories.length &&
    !hasNextPosts &&
    !hasNextHn;

  if (showEmptyState) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        <p>You don't have any bookmarks yet.</p>
        <p className="mt-2 text-sm">
          Bookmark posts and HackerNews stories to read them later.
        </p>
      </Card>
    );
  }

  return (
    <Tabs className="w-full" defaultValue="posts">
      <div className="relative mb-8 flex justify-center">
        <motion.div
          animate="visible"
          className="relative w-full px-4 sm:w-auto sm:px-0"
          initial="hidden"
          transition={{ duration: 0.5 }}
          variants={tabVariants}
        >
          <div className="absolute -inset-3 hidden rounded-lg bg-gradient-to-r from-orange-500/20 via-yellow-500/20 to-orange-500/20 blur-xl sm:block" />
          <TabsList className="relative grid w-full grid-cols-2 rounded-full bg-background/95 p-1 text-muted-foreground shadow-xl backdrop-blur-xs sm:w-[400px]">
            <TabsTrigger
              className="relative rounded-full data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-500"
              value="posts"
            >
              <Newspaper className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Posts</span>
              <span className="sm:hidden">Posts</span>
              {posts.length > 0 && (
                <span className="ml-2 rounded-full bg-orange-500/10 px-2 py-0.5 text-orange-500 text-xs">
                  {posts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              className="relative rounded-full data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-500"
              value="hackernews"
            >
              <Terminal className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">HackerNews</span>
              <span className="sm:hidden">HN</span>
              {hnStories.length > 0 && (
                <span className="ml-2 rounded-full bg-orange-500/10 px-2 py-0.5 text-orange-500 text-xs">
                  {hnStories.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </motion.div>
      </div>

      <motion.div
        animate={{ opacity: 1 }}
        initial={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        <TabsContent value="posts">
          <InfiniteScrollContainer
            className="space-y-5"
            onBottomReached={() =>
              hasNextPosts && !isFetchingPosts && fetchNextPosts()
            }
          >
            {posts.map((post) => (
              <Post key={post.id} post={post} />
            ))}
            {isFetchingNextPosts && <LoadMoreSkeleton />}
          </InfiniteScrollContainer>
        </TabsContent>

        <TabsContent value="hackernews">
          <InfiniteScrollContainer
            className="space-y-4"
            onBottomReached={() => hasNextHn && !isFetchingHn && fetchNextHn()}
          >
            {hnStories.map((story) => (
              <HNStory key={story.id} story={story} />
            ))}
            {isFetchingNextHn && <LoadMoreSkeleton />}
          </InfiniteScrollContainer>
        </TabsContent>
      </motion.div>
    </Tabs>
  );
}
