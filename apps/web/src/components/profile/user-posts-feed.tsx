"use client";

import type { PostsPage } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import PostsOnlyLoadingSkeleton from "@/components/layouts/skeletons/post-only-loading-skeleton";
import kyInstance from "@/lib/ky";

interface UserPostsFeedProps {
  filter?: "all" | "media";
  userId: string;
}

const UserPostsFeed: React.FC<UserPostsFeedProps> = ({
  userId,
  filter = "all",
}) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "user-posts", userId, filter],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/posts`,
          pageParam
            ? { searchParams: { cursor: pageParam, filter } }
            : { searchParams: { filter } }
        )
        .json<PostsPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (status === "pending") {
    return <PostsOnlyLoadingSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="text-center text-destructive">
        An error occurred while loading posts.
      </p>
    );
  }

  if (status === "success" && !posts.length) {
    return (
      <p className="text-center text-muted-foreground">
        {filter === "media"
          ? "No media posts yet."
          : "No posts yet. Share something!"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <InfiniteScrollContainer
        className="space-y-5"
        onBottomReached={handleBottomReached}
      >
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
        {isFetchingNextPage ? (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : null}
      </InfiniteScrollContainer>
    </div>
  );
};

export default React.memo(UserPostsFeed);
