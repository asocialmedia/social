"use client";

import type { PostsPage } from "@asm/db";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo } from "react";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";
import { FeedView } from "./feed-view";

interface HomeFeedProps {
  excludePostId?: string;
  variant?: "trending" | "global";
}

export default function HomeFeed({
  variant = "global",
  excludePostId,
}: HomeFeedProps) {
  const isTrending = variant === "trending";
  const queryKey = ["post-feed", isTrending ? "trending" : "for-you"];
  const endpoint = isTrending ? "/api/posts/trending" : "/api/posts/for-you";

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const result = await kyInstance
        .get(endpoint, pageParam ? { searchParams: { cursor: pageParam } } : {})
        .json<PostsPage>();
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const posts = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.posts) || [])
        .filter(Boolean)
        .filter((post) => post.id !== excludePostId),
    [data?.pages, excludePostId]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  if (status === "pending") {
    return <FeedViewSkeleton />;
  }

  if (status === "success" && !posts.length && !hasNextPage) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noFeedImage}
          width={1536}
        />
        <p className="text-muted-foreground text-sm sm:text-base">
          {isTrending ? "No trending fleets yet." : "No Fleets to show here."}
        </p>
        <p className="text-muted-foreground/70 text-xs sm:text-sm">
          {isTrending
            ? "Posts with the most aura will surface here."
            : "Follow more users to see their fleets in your feed."}
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive text-sm sm:text-base">
          An error occurred while loading posts.
        </p>
        <p className="mt-2 text-muted-foreground/70 text-xs sm:text-sm">
          Please try refreshing the page.
        </p>
      </div>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {posts.length > 0 && (
        <FeedView
          cacheKey={queryKey}
          excludePostId={excludePostId}
          posts={posts}
          sortBy={isTrending ? "server" : "newest"}
        />
      )}
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}
