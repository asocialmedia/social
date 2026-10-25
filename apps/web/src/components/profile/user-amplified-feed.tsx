"use client";

import type { PostsPage } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import React, { useCallback, useMemo } from "react";

import GustRowCard from "@/components/gusts/gust-row-card";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import kyInstance from "@/lib/ky";
import { FEED_CACHE_RETENTION_MS } from "@/lib/posts/feed-cache";
import { profileActivityOrder } from "@/lib/posts/profile-activity-order";

import EmptyFeedState from "./empty-feed-state";
import { ExternalActivityCard } from "./external-activity-card";
import FeedCaughtUp from "./feed-caught-up";
import { useExternalProfileActivity } from "./use-external-profile-activity";

interface UserAmplifiedFeedProps {
  userId: string;
}

const UserAmplifiedFeed: React.FC<UserAmplifiedFeedProps> = ({ userId }) => {
  const external = useExternalProfileActivity(userId, "amplified");
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    // Kept past a post/media detour so coming back restores the cached list
    // (and its scroll position) instead of refetching from the top.
    gcTime: FEED_CACHE_RETENTION_MS,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          `/api/users/${userId}/amplified`,
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>(),
    queryKey: ["post-feed", "user-amplified", userId],
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const activity = profileActivityOrder([
    ...posts.map((post) => ({
      at: String("amplifiedAt" in post ? post.amplifiedAt : post.createdAt),
      id: post.id,
      post,
      type: "native" as const,
    })),
    ...(external.data?.pages.flatMap((page) => page.items) ?? []).map(
      (item) => ({
        at: item.createdAt,
        id: item.id,
        item,
        type: "external" as const,
      })
    ),
  ]);
  const handleBottomReached = useCallback(() => {
    if (external.hasNextPage && !external.isFetching) {
      void external.fetchNextPage();
    }
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage, external]);

  if (status === "pending" && !activity.length) {
    return <FeedViewSkeleton />;
  }

  if (status === "error" && !activity.length) {
    return (
      <p className="text-destructive text-center">
        An error occurred while loading amplified posts.
      </p>
    );
  }

  if (
    status === "success" &&
    !external.isPending &&
    !external.isError &&
    !activity.length
  ) {
    return (
      <EmptyFeedState
        description="Posts this profile has amplified will show up here."
        title="No amplified posts yet"
      />
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {activity.map((entry, index) => {
        let card;
        if (entry.type === "external") {
          card = <ExternalActivityCard item={entry.item} />;
        } else if (entry.post.isGust) {
          card = <GustRowCard post={entry.post} />;
        } else {
          card = <PostCard isJoined post={entry.post} />;
        }
        return (
          <React.Fragment key={`${entry.type}:${entry.id}`}>
            {index > 0 && <Separator className="bg-border/60" />}
            {card}
          </React.Fragment>
        );
      })}
      {external.isError ? (
        <p className="text-destructive p-4 text-center text-sm">
          Couldn’t load Bluesky amplifications.{" "}
          <button
            type="button"
            onClick={() => {
              void external.refetch();
            }}
          >
            Try again
          </button>
        </p>
      ) : null}
      {isFetchingNextPage ||
      external.isPending ||
      external.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="text-primary animate-spin" />
        </div>
      ) : null}
      {!hasNextPage &&
      !external.hasNextPage &&
      !external.isPending &&
      !external.isError &&
      activity.length > 0 ? (
        <FeedCaughtUp note="You've seen every amplified post from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserAmplifiedFeed);
