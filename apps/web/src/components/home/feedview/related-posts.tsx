"use client";

import type { PostData } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";

// eslint-disable-next-line import/no-cycle -- related posts reuse post-card which renders media-previews, which opens this viewer
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
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }: { pageParam: string | null }) => {
        const result = await kyInstance
          .get(
            "/api/posts/for-you",
            pageParam
              ? { searchParams: { cursor: pageParam, excludeModerated: "1" } }
              : { searchParams: { excludeModerated: "1" } }
          )
          .json<{ posts: PostData[]; nextCursor: string | null }>();
        return result;
      },
      queryKey: ["related-posts", excludePostId],
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
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
        <div className="bg-border/40 h-32 animate-pulse rounded-lg" />
        <div className="bg-border/40 h-32 animate-pulse rounded-lg" />
        <div className="bg-border/40 h-32 animate-pulse rounded-lg" />
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
