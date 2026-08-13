"use client";

import type { PostsPage } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import type React from "react";
import { useCallback } from "react";
import { FeedView } from "@/components/home/feed-view";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";

const LikedPosts: React.FC = () => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["liked-posts"],
    queryFn: async ({ pageParam }) => {
      const response = await kyInstance
        .get(
          "/api/posts/liked",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>();
      return response;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const likedPosts = (data?.pages.flatMap((page) => page.posts) || []).filter(
    Boolean
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  if (status === "pending") {
    return <FeedViewSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="px-4 py-8 text-center text-destructive">
        An error occurred while loading liked posts.
      </p>
    );
  }

  if (likedPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
        <Heart className="h-6 w-6 text-muted-foreground/60" />
        <p className="font-medium">No liked posts yet.</p>
        <p className="text-muted-foreground text-sm">
          Posts you amplify will show up here.
        </p>
      </div>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      <FeedView cacheKey={["liked-posts"]} posts={likedPosts} />
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
};

export default LikedPosts;
