"use client";

import type { PostsPage } from "@asm/db";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback } from "react";

import { FeedView } from "@/components/home/feed-view";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";

export default function FollowingFeed() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          "/api/posts/following",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>(),
    queryKey: ["post-feed", "following"],
  });

  const posts = data?.pages.flatMap((page) => page.posts) || [];

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
        <p className="text-muted-foreground">
          No Fleets found. Start following people to see their Fleets here!
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <p className="text-destructive text-center">
        An error occurred while loading posts.
      </p>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      <FeedView posts={posts} />
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}
