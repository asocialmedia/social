"use client";

import type { PostsPage } from "@asm/db";
import { feedAvailability } from "@asm/protocols/discovery";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import { FeedView } from "@/components/home/feed-view";
import FeedEnd from "@/components/home/feedview/feed-end";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useBlueskyFeed } from "@/components/protocols/use-bluesky-feed";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import kyInstance from "@/lib/ky";
import {
  FEED_QUERY_BEHAVIOR,
  prependPostsToFeedCache,
  scrollFeedToTop,
} from "@/lib/posts/feed-cache";
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
    isFetchedAfterMount,
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
  // avatar badge. Nothing moves until the badge is tapped.
  const { clearNewItems, newItems } = useNewContentProbe({
    enabled: network.ready && source !== "bluesky" && status === "success",
    eventSource: "asm",
    fetchHead: async () => {
      const fresh = await kyInstance
        .get("/api/posts/following", {
          searchParams: { network: network.scope },
        })
        .json<PostsPage>();
      return fresh.posts;
    },
    probeOnMount: !isFetchedAfterMount,
    resetKey: `following:${user?.id ?? "guest"}:${network.scope}`,
    visible: posts,
  });

  const handleBottomReached = useCallback(() => {
    if (source !== "asm" && external.hasNextPage && !external.isFetching) {
      void external.fetchNextPage();
    }
    if (source !== "bluesky" && hasNextPage && !isFetching) {
      fetchNextPage({ cancelRefetch: false });
    }
  }, [fetchNextPage, hasNextPage, isFetching, source, external]);

  const showNewPosts = useCallback(() => {
    clearNewItems();
    prependPostsToFeedCache(queryClient, queryKey, newItems);
    scrollFeedToTop(feedRootRef.current);
  }, [clearNewItems, newItems, queryClient, queryKey]);

  const nativeHasMore = source !== "bluesky" && hasNextPage;
  const externalHasMore = source !== "asm" && external.hasNextPage;
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
  if (availability === "loading") {
    return <FeedViewSkeleton />;
  }
  if (availability === "empty" && !nativeHasMore && !externalHasMore) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
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
      <p className="text-destructive text-center">
        Couldn't load Following.{" "}
        <button
          type="button"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey });
            void external.refetch();
          }}
        >
          Retry
        </button>
      </p>
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
      {external.newItems.length ? (
        <div className="pointer-events-none sticky top-3 z-20 -mb-10 flex justify-center">
          <NewContentPill
            authors={external.newItems.map((post) => ({
              avatarUrl: post.author.avatarUrl,
              id: post.author.id,
              username: post.author.handle,
            }))}
            count={external.newItems.length}
            noun="post"
            onClick={() => external.showNewItems()}
          />
        </div>
      ) : null}
      {source !== "asm" && external.isError ? (
        <p className="text-muted-foreground p-3 text-center text-sm">
          Bluesky is temporarily unavailable.{" "}
          <button
            type="button"
            onClick={() => {
              /* empty */
            }}
          >
            Retry
          </button>
        </p>
      ) : null}
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <FeedView
          cacheKey={queryKey}
          posts={posts}
          externalPosts={externalPosts}
          source={source}
        />
        {isFetchingNextPage || external.isFetchingNextPage ? (
          <LoadMoreSkeleton />
        ) : null}
        {posts.length + externalPosts.length > 0 &&
        !nativeHasMore &&
        !externalHasMore ? (
          <FeedEnd />
        ) : null}
      </InfiniteScrollContainer>
    </div>
  );
}
