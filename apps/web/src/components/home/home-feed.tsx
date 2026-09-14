"use client";

import type { PostsPage } from "@asm/db";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import kyInstance from "@/lib/ky";
import {
  FEED_QUERY_BEHAVIOR,
  prependPostsToFeedCache,
  scrollFeedToTop,
} from "@/lib/posts/feed-cache";

import { FeedView } from "./feed-view";
import FeedEnd from "./feedview/feed-end";

interface HomeFeedProps {
  excludePostId?: string;
  variant?: "latest" | "personalized" | "trending" | "global";
}

// Named export kept for the feed-behavior test; the values live in the shared
// feed-cache module so Following and Gusts cannot drift from it.
export const HOME_FEED_QUERY_BEHAVIOR = FEED_QUERY_BEHAVIOR;

export default function HomeFeed({
  variant = "personalized",
  excludePostId,
}: HomeFeedProps) {
  const { user } = useSession();
  const isTrending = variant === "trending";
  const isLatest = variant === "latest";
  const isPersonalized = variant === "personalized" || variant === "global";
  let feedKey = "for-you";
  let endpoint = "/api/posts/for-you";
  if (isTrending) {
    feedKey = "trending";
    endpoint = "/api/posts/trending";
  } else if (isLatest) {
    feedKey = "latest";
    endpoint = "/api/posts/latest";
  }
  const queryKey = useMemo(
    () => ["post-feed", feedKey, user?.id ?? "guest"],
    [feedKey, user?.id]
  );

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
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const result = await kyInstance
        .get(endpoint, pageParam ? { searchParams: { cursor: pageParam } } : {})
        .json<PostsPage>();
      return result;
    },
    queryKey,
    ...HOME_FEED_QUERY_BEHAVIOR,
  });

  const posts = useMemo(() => {
    const list = (data?.pages.flatMap((page) => page.posts) || [])
      .filter(Boolean)
      .filter((post) => post.id !== excludePostId);
    // Rank shifts between paginated refetches can land the same post on two
    // pages (tail of one, head of the next); React keys demand uniqueness.
    return [...new Map(list.map((post) => [post.id, post])).values()];
  }, [data?.pages, excludePostId]);

  const queryClient = useQueryClient();
  const feedRootRef = useRef<HTMLDivElement>(null);

  // Head-only probe: new posts from other people collect in `newPosts` and are
  // surfaced as an avatar badge. The rendered feed and its scroll position stay
  // exactly where they are until the viewer taps the badge.
  const { clearNewItems, newItems: newPosts } = useNewContentProbe({
    enabled: !excludePostId,
    fetchHead: async () => {
      const fresh = await kyInstance.get(endpoint).json<PostsPage>();
      return fresh.posts;
    },
    visible: posts,
  });

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  // Merge the probed posts straight into the head of the cached feed, then
  // bring the viewer up to meet them. No refetch and no skeleton: the feed is
  // already on screen, we only reveal what the probe found.
  const showNewPosts = useCallback(() => {
    clearNewItems();
    prependPostsToFeedCache(queryClient, queryKey, newPosts);
    scrollFeedToTop(feedRootRef.current);
  }, [clearNewItems, newPosts, queryClient, queryKey]);

  if (status === "pending") {
    return <FeedViewSkeleton />;
  }

  let emptyTitle = "No personalized Fleets to show here.";
  let emptyDescription =
    "Your feed will learn from what you read, amplify, bookmark, and discuss.";
  if (isTrending) {
    emptyTitle = "No trending fleets yet.";
    emptyDescription = "Posts with the most aura will surface here.";
  } else if (isLatest) {
    emptyTitle = "No Fleets yet.";
    emptyDescription = "The latest Fleets will appear here.";
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
        <p className="text-muted-foreground text-sm sm:text-base">
          {emptyTitle}
        </p>
        <p className="text-muted-foreground/70 text-xs sm:text-sm">
          {emptyDescription}
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive text-sm sm:text-base">
          An error occurred while loading posts.
        </p>
        <p className="text-muted-foreground/70 mt-2 text-xs sm:text-sm">
          Please try refreshing the page.
        </p>
      </div>
    );
  }

  return (
    <div className="relative" ref={feedRootRef}>
      {!excludePostId && newPosts.length > 0 ? (
        <div className="pointer-events-none sticky top-3 z-20 flex justify-center">
          <NewContentPill
            authors={[
              ...new Map(
                newPosts.map((post) => [
                  post.userId,
                  {
                    avatarUrl: post.user?.avatarUrl,
                    id: post.userId,
                    username: post.user?.username,
                  },
                ])
              ).values(),
            ]}
            count={newPosts.length}
            noun="post"
            onClick={showNewPosts}
          />
        </div>
      ) : null}
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        {posts.length > 0 && (
          <FeedView
            cacheKey={queryKey}
            excludePostId={excludePostId}
            posts={posts}
            sortBy={isTrending || isPersonalized ? "server" : "newest"}
          />
        )}
        {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
        {posts.length > 0 && !hasNextPage ? <FeedEnd /> : null}
      </InfiniteScrollContainer>
    </div>
  );
}
