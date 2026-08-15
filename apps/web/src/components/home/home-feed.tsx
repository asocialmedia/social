"use client";

import type { PostsPage } from "@asm/db";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";

import { FeedView } from "./feed-view";
import FeedEnd from "./feedview/feed-end";

interface HomeFeedProps {
  excludePostId?: string;
  variant?: "trending" | "global";
}

export default function HomeFeed({
  variant = "global",
  excludePostId,
}: HomeFeedProps) {
  const isTrending = variant === "trending";
  const queryKey = ["post-feed", isTrending ? "trending" : "for-you"];
  const endpoint = isTrending ? "/api/posts/trending" : "/api/posts/for-you";

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
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
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000, // 30 seconds,
  });

  const posts = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.posts) || [])
        .filter(Boolean)
        .filter((post) => post.id !== excludePostId),
    [data?.pages, excludePostId]
  );

  // Track the newest id seen so far so a background poll can surface a "new
  // posts" pill without touching the feed's data (or the user's scroll
  // position) until they tap it.
  const newestIdRef = useRef<string | null>(null);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const feedRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (posts.length > 0 && !newestIdRef.current) {
      newestIdRef.current = posts[0].id;
    }
  }, [posts]);

  // Poll quietly every 45s for the newest post id only. When a brand-new post
  // appears, reveal the pill; the feed itself is left alone so the user's
  // scroll position never jumps out from under them.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const fresh = await kyInstance.get(endpoint).json<PostsPage>();
          const newest = fresh.posts[0]?.id;
          if (newest && newest !== newestIdRef.current) {
            newestIdRef.current = newest;
            const knownIds = new Set(posts.map((p) => p.id));
            let count = 0;
            for (const post of fresh.posts) {
              if (knownIds.has(post.id)) {
                break;
              }
              count += 1;
            }
            if (count > 0) {
              setNewPostsCount(count);
            }
          }
        } catch {
          // Best-effort polling; ignore transient failures
        }
      })();
    }, 45 * 1000);
    return () => window.clearInterval(interval);
  }, [endpoint, posts]);

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  // Pull the freshly polled posts into the feed: refetch so they land at the
  // top, then scroll the nearest scrollable ancestor back up to meet them.
  const showNewPosts = useCallback(async () => {
    setNewPostsCount(0);
    await refetch();
    let node: HTMLElement | null = feedRootRef.current;
    while (node) {
      if (node.scrollHeight > node.clientHeight) {
        node.scrollTo({ behavior: "smooth", top: 0 });
        break;
      }
      node = node.parentElement;
    }
  }, [refetch]);

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
        <p className="text-muted-foreground text-sm sm:text-base">
          {isTrending ? "No trending fleets yet." : "No Fleets to show here."}
        </p>
        <p className="text-muted-foreground/70 text-xs sm:text-sm">
          {isTrending
            ? "Posts with the most aura will surface here."
            : "Follow more users to see their fleets in your feed."}
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
      {newPostsCount > 0 ? (
        <div className="pointer-events-none sticky top-3 z-20 flex justify-center">
          <button
            className="rail-3d-btn pointer-events-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium"
            onClick={showNewPosts}
            type="button"
          >
            <RefreshCw className="size-4" />
            {newPostsCount} new post{newPostsCount === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        {posts.length > 0 && (
          <FeedView
            cacheKey={queryKey}
            excludePostId={excludePostId}
            posts={posts}
            sortBy={isTrending ? "server" : "newest"}
          />
        )}
        {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
        {posts.length > 0 && !hasNextPage ? <FeedEnd /> : null}
      </InfiniteScrollContainer>
    </div>
  );
}
