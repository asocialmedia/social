"use client";

import type { PostsPage } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import PostsOnlyLoadingSkeleton from "@/components/layouts/skeletons/post-only-loading-skeleton";
import kyInstance from "@/lib/ky";

interface HashtagFeedProps {
  tag: string;
}

export default function HashtagFeed({ tag }: HashtagFeedProps) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "hashtag", tag],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get("/api/search", {
          searchParams: {
            q: tag,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        })
        .json<PostsPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    gcTime: 0,
  });

  const posts = data?.pages.flatMap((page) => page.posts) || [];

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  if (status === "pending") {
    return <PostsOnlyLoadingSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="px-4 py-8 text-center text-destructive">
        An error occurred while loading posts for this tag.
      </p>
    );
  }

  if (!posts.length) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="font-medium">No posts found for #{tag}</p>
        <p className="mt-1 text-muted-foreground text-sm">
          Be the first to rustle something about this topic.
        </p>
      </div>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      <div className="space-y-0">
        {posts.map((post) => (
          <PostCard isJoined key={post.id} post={post} />
        ))}
      </div>
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}
