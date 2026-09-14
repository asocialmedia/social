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

interface UserResponsesFeedProps {
  isOwnProfile?: boolean;
  userId: string;
}

// The Responses tab: posts that reply to another post, each rendered with the
// compact parent card PostCard shows for a response.
const UserResponsesFeed: React.FC<UserResponsesFeedProps> = ({
  userId,
  isOwnProfile = false,
}) => {
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
          `/api/users/${userId}/responses`,
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>(),
    queryKey: ["post-feed", "user-responses", userId],
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
      <p className="text-destructive text-center">
        An error occurred while loading responses.
      </p>
    );
  }

  if (status === "success" && !posts.length) {
    return (
      <EmptyFeedState
        description={
          isOwnProfile
            ? "Replies you post to other fleets will show up here."
            : "Replies from this profile will show up here."
        }
        title="No responses yet"
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
          <Loader2 className="text-primary animate-spin" />
        </div>
      ) : null}
      {!hasNextPage && posts.length > 0 ? (
        <FeedCaughtUp note="You've seen every response from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserResponsesFeed);
