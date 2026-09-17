"use client";

import type { PostsPage } from "@asm/db";
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
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import kyInstance from "@/lib/ky";
import {
  FEED_QUERY_BEHAVIOR,
  prependPostsToFeedCache,
  scrollFeedToTop,
} from "@/lib/posts/feed-cache";

export default function FollowingFeed() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const feedRootRef = useRef<HTMLDivElement>(null);
  const queryKey = useMemo(
    () => ["post-feed", "following", user?.id ?? "guest"],
    [user?.id]
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
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          "/api/posts/following",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
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
    fetchHead: async () => {
      const fresh = await kyInstance
        .get("/api/posts/following")
        .json<PostsPage>();
      return fresh.posts;
    },
    visible: posts,
  });

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const showNewPosts = useCallback(() => {
    clearNewItems();
    prependPostsToFeedCache(queryClient, queryKey, newItems);
    scrollFeedToTop(feedRootRef.current);
  }, [clearNewItems, newItems, queryClient, queryKey]);

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
    <div className="relative" ref={feedRootRef}>
      {newItems.length > 0 ? (
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
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <FeedView cacheKey={queryKey} posts={posts} />
        {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
        {posts.length > 0 && !hasNextPage ? <FeedEnd /> : null}
      </InfiniteScrollContainer>
    </div>
  );
}
