"use client";

import type { PostsPage } from "@asm/db";
import { feedAvailability } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import { FeedView } from "@/components/home/feed-view";
import FeedEnd from "@/components/home/feedview/feed-end";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useBlueskyFeed } from "@/components/protocols/use-bluesky-feed";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import { useSeamlessFeedHead } from "@/hooks/feed/use-seamless-feed-head";
import kyInstance from "@/lib/ky";
import {
  FEED_QUERY_BEHAVIOR,
  prependPostsToFeedCache,
  revealFeedHead,
} from "@/lib/posts/feed-cache";
import { feedContinuationDelay } from "@/lib/posts/feed-pagination";
import { useFeedSourceStore } from "@/store/feed-source-store";

export default function FollowingFeed() {
  const network = useNetworkSettings();
  const { user } = useSession();
  const source = useFeedSourceStore((state) => state.source);
  const external = useBlueskyFeed(
    "latest",
    network.ready && Boolean(user) && source !== "asm",
    user?.id ?? "guest",
    "all",
    true
  );
  const externalPosts =
    external.data?.pages.flatMap((page) => page.items) ?? [];
  const queryClient = useQueryClient();
  const feedRootRef = useRef<HTMLDivElement>(null);
  const queryKey = useMemo(
    () => ["post-feed", "following", user?.id ?? "guest", network.scope],
    [user?.id, network.scope]
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    enabled: network.ready && source !== "bluesky",
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get("/api/posts/following", {
          searchParams: {
            network: network.scope,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        })
        .json<PostsPage>(),
    queryKey,
    ...FEED_QUERY_BEHAVIOR,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  // Head-only probe so cached pages stay visible while new follows arrive as an
  // avatar badge. Reveal them on a badge click or an upward return to the head.
  const { clearNewItems, newItems, probeNow } = useNewContentProbe({
    enabled: network.ready && source !== "bluesky" && status === "success",
    eventSource: "asm",
    fetchHead: async (signal) => {
      const fresh = await kyInstance
        .get("/api/posts/following", {
          searchParams: { network: network.scope },
          signal,
        })
        .json<PostsPage>();
      return fresh.posts;
    },
    probeOnMount: true,
    resetKey: `following:${user?.id ?? "guest"}:${network.scope}`,
    visible: posts,
  });

  const handleBottomReached = useCallback(
    (manual = false) => {
      if (
        source !== "asm" &&
        external.hasNextPage &&
        !external.isFetching &&
        (manual || !external.isError)
      ) {
        void external.fetchNextPage({ cancelRefetch: false });
      }
      if (
        source !== "bluesky" &&
        hasNextPage &&
        !isFetching &&
        (manual || status !== "error")
      ) {
        fetchNextPage({ cancelRefetch: false });
      }
    },
    [fetchNextPage, hasNextPage, isFetching, source, external, status]
  );

  const mergeNewPosts = useCallback(() => {
    if (source !== "bluesky") {
      clearNewItems();
      prependPostsToFeedCache(queryClient, queryKey, newItems);
    }
    if (source !== "asm") {
      external.showNewItems();
    }
  }, [clearNewItems, newItems, queryClient, queryKey, external, source]);
  const showNewPosts = useCallback(() => {
    revealFeedHead(feedRootRef.current, mergeNewPosts);
  }, [mergeNewPosts]);
  useSeamlessFeedHead({
    count:
      (source === "bluesky" ? 0 : newItems.length) +
      (source === "asm" ? 0 : external.newItems.length),
    enabled: network.ready,
    merge: mergeNewPosts,
    probe: () =>
      Promise.all([
        source === "bluesky" ? Promise.resolve() : probeNow(),
        source === "asm" ? Promise.resolve() : external.probeNow(),
      ]),
    root: feedRootRef,
  });

  const nativeHasMore = source !== "bluesky" && hasNextPage;
  const externalHasMore = source !== "asm" && external.hasNextPage;
  const manualContinuation =
    (nativeHasMore || externalHasMore) &&
    (status === "error" || external.isError) &&
    !isFetching &&
    !external.isFetching ? (
      <div className="flex justify-center p-4">
        <Button variant="premium" onClick={() => handleBottomReached(true)}>
          Load more posts
        </Button>
      </div>
    ) : null;
  const availability = feedAvailability({
    count:
      (source === "bluesky" ? 0 : posts.length) +
      (source === "asm" ? 0 : externalPosts.length),
    externalEnabled: source !== "asm",
    externalError: external.isError,
    externalLoading: external.isPending,
    nativeEnabled: source !== "bluesky",
    nativeError: status === "error",
    nativeLoading: status === "pending",
  });
  if (!network.ready && network.isError) {
    return (
      <FeedErrorState
        message="We couldn’t load your feed preferences. Please try again."
        onRetry={() => {
          void network.refetch();
        }}
        isRetrying={network.isFetching}
      />
    );
  }
  if (availability === "loading") {
    return (
      <div ref={feedRootRef}>
        <FeedViewSkeleton />
      </div>
    );
  }
  if (availability === "empty" && !nativeHasMore && !externalHasMore) {
    return (
      <div
        ref={feedRootRef}
        className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center"
      >
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          // This illustration IS the feed when nobody is followed yet, so it is
          // the largest paint on the empty tab.
          loading="eager"
          src={noFeedImage}
          width={1536}
        />
        <p className="text-muted-foreground">
          No Fleets found. Start following people to see their Fleets here!
        </p>
      </div>
    );
  }

  if (availability === "error") {
    return (
      <div ref={feedRootRef}>
        <FeedErrorState
          message="We couldn’t load posts from the people you follow. Please try again."
          onRetry={() => {
            void queryClient.invalidateQueries({ queryKey });
            void external.refetch();
          }}
        />
        {manualContinuation}
      </div>
    );
  }

  return (
    <div className="relative" ref={feedRootRef}>
      {source !== "bluesky" && newItems.length > 0 ? (
        <div className="pointer-events-none sticky top-3 z-20 flex justify-center">
          <NewContentPill
            authors={[
              ...new Map(
                newItems.map((post) => [
                  post.userId,
                  {
                    avatarUrl: post.user?.avatarUrl,
                    id: post.userId,
                    username: post.user?.username,
                  },
                ])
              ).values(),
            ]}
            count={newItems.length}
            noun="post"
            onClick={showNewPosts}
          />
        </div>
      ) : null}
      {source !== "asm" && external.newItems.length ? (
        <div className="pointer-events-none sticky top-3 z-20 -mb-10 flex justify-center">
          <NewContentPill
            authors={external.newItems.map((post) => ({
              avatarUrl: post.author.avatarUrl,
              id: post.author.id,
              username: post.author.handle,
            }))}
            count={external.newItems.length}
            noun="post"
            onClick={showNewPosts}
          />
        </div>
      ) : null}
      {source !== "asm" && external.isError ? (
        <FeedErrorState
          compact
          message="Bluesky posts couldn’t load right now. Please try again in a moment."
          isRetrying={external.isFetching}
          onRetry={() => {
            if (external.hasNextPage) {
              void external.fetchNextPage({ cancelRefetch: false });
            } else {
              void external.refetch();
            }
          }}
        />
      ) : null}
      {source !== "bluesky" && status === "error" ? (
        <FeedErrorState
          compact
          message="Some posts couldn’t load right now. Please try again."
          isRetrying={isFetching}
          onRetry={() => {
            if (hasNextPage) {
              void fetchNextPage({ cancelRefetch: false });
            } else {
              void queryClient.invalidateQueries({ queryKey });
            }
          }}
        />
      ) : null}
      <InfiniteScrollContainer
        continuationDelay={Math.max(
          nativeHasMore
            ? feedContinuationDelay(data?.pages, (page) => page.posts)
            : 0,
          externalHasMore
            ? feedContinuationDelay(external.data?.pages, (page) => page.items)
            : 0
        )}
        onBottomReached={handleBottomReached}
      >
        <FeedView
          cacheKey={queryKey}
          posts={posts}
          externalPosts={externalPosts}
          source={source}
        />
        {isFetchingNextPage || external.isFetchingNextPage ? (
          <LoadMoreSkeleton />
        ) : null}
        {manualContinuation}
        {posts.length + externalPosts.length > 0 &&
        !nativeHasMore &&
        !externalHasMore ? (
          <FeedEnd />
        ) : null}
      </InfiniteScrollContainer>
    </div>
  );
}
