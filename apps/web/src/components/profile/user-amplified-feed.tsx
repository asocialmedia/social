"use client";

import type { PostsPage } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import kyInstance from "@/lib/ky";
import EmptyFeedState from "./empty-feed-state";
import FeedCaughtUp from "./feed-caught-up";

interface UserAmplifiedFeedProps {
  userId: string;
}

const UserAmplifiedFeed: React.FC<UserAmplifiedFeedProps> = ({ userId }) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "user-amplified", userId],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/amplified`,
          pageParam ? { searchParams: { cursor: pageParam } } : {}
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
    return <FeedViewSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="text-center text-destructive">
        An error occurred while loading amplified posts.
      </p>
    );
  }

  if (status === "success" && !posts.length) {
    return (
      <EmptyFeedState
        description="Posts this profile has amplified will show up here."
        title="No amplified posts yet"
      />
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {posts.map((post, index) => (
        <React.Fragment key={post.id}>
          {index > 0 && <Separator className="bg-border/60" />}
          <PostCard isJoined post={post} />
        </React.Fragment>
      ))}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-primary" />
        </div>
      ) : null}
      {!hasNextPage && posts.length > 0 ? (
        <FeedCaughtUp note="You've seen every amplified post from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserAmplifiedFeed);
