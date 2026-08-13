"use client";

import type { PostData } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";
import PostCard from "./post-card";

interface RelatedPostsProps {
  excludePostId: string;
}

// Related-post list for the media viewer sidebar. Uses the same PostCard
// component as the rest of the app so the posts look identical everywhere,
// paginated via the same cursor-based endpoint + infinite scroll.
export default function RelatedPosts({ excludePostId }: RelatedPostsProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } =
    useInfiniteQuery({
      queryKey: ["related-posts", excludePostId],
      queryFn: async ({ pageParam }) => {
        const result = await kyInstance
          .get(
            "/api/posts/for-you",
            pageParam ? { searchParams: { cursor: pageParam } } : {}
          )
          .json<{ posts: PostData[]; nextCursor: string | null }>();
        return result;
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    });

  const posts = (data?.pages.flatMap((page) => page.posts) || []).filter(
    (post) => post.id !== excludePostId
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (status === "pending") {
    return (
      <div className="space-y-3 px-4 py-3">
        <div className="h-32 animate-pulse rounded-lg bg-border/40" />
        <div className="h-32 animate-pulse rounded-lg bg-border/40" />
        <div className="h-32 animate-pulse rounded-lg bg-border/40" />
      </div>
    );
  }

  if (status === "error" || posts.length === 0) {
    return null;
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {posts.map((post) => (
        <PostCard isJoined key={post.id} post={post} />
      ))}
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}
