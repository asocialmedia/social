"use client";

import type { PostsPage } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import React, { useMemo } from "react";

import { FeedErrorState } from "@/components/feeds/feed-error-state";
import GustRowCard from "@/components/gusts/gust-row-card";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import kyInstance from "@/lib/ky";
import { FEED_CACHE_RETENTION_MS } from "@/lib/posts/feed-cache";
import {
  profileActivityOrder,
  advanceProfileActivity,
} from "@/lib/posts/profile-activity-order";

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
    refetch,
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
        .json<PostsPage & { nextCursorAt?: string | null }>(),
    queryKey: ["post-feed", "user-amplified", userId],
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const sources = [
    {
      boundary: data?.pages.at(-1)?.nextCursorAt,
      hasNextPage,
      pending: status === "pending",
    },
    {
      boundary: external.data?.pages.at(-1)?.nextCursor?.at,
      hasNextPage: external.hasNextPage,
      pending: external.loading,
    },
  ];
  const [advanceNative, advanceExternal] = advanceProfileActivity(sources);
  const activity = profileActivityOrder(
    [
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
    ],
    sources
  );
  const handleBottomReached = () => {
    if (advanceExternal && !external.isFetching && !external.isError) {
      void external.fetchNextPage();
    }
    if (advanceNative && !isFetching && status !== "error") {
      fetchNextPage();
    }
  };

  if (status === "pending" && !activity.length) {
    return <FeedViewSkeleton />;
  }

  if (status === "error" && !data && !external.data) {
    return (
      <FeedErrorState
        message="Couldn’t load amplified posts."
        isRetrying={isFetching}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  if (
    status === "success" &&
    !external.loading &&
    !external.isError &&
    !external.networkError &&
    !hasNextPage &&
    !external.hasNextPage &&
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
      {status === "error" ? (
        <FeedErrorState
          compact
          message="Couldn’t load more amplified posts."
          isRetrying={isFetching}
          onRetry={() => {
            void (data ? fetchNextPage() : refetch());
          }}
        />
      ) : null}
      {external.networkError ? (
        <FeedErrorState
          compact
          message="Couldn’t load your content settings for Bluesky activity."
          isRetrying={false}
          onRetry={() => {
            void external.retryNetworkSettings();
          }}
        />
      ) : null}
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
      {isFetchingNextPage || external.loading || external.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="text-primary animate-spin" />
        </div>
      ) : null}
      {status !== "error" &&
      !hasNextPage &&
      !external.hasNextPage &&
      !external.loading &&
      !external.isError &&
      !external.networkError &&
      activity.length > 0 ? (
        <FeedCaughtUp note="You've seen every amplified post from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserAmplifiedFeed);
