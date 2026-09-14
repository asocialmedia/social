"use client";

import type { PostData, PostsPage } from "@asm/db";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";

import { FeedView } from "./feed-view";
import FeedEnd from "./feedview/feed-end";

interface HomeFeedProps {
  excludePostId?: string;
  variant?: "latest" | "personalized" | "trending" | "global";
}

export const HOME_FEED_QUERY_BEHAVIOR = {
  // Radix unmounts inactive tabs. A response or post published while a tab is
  // unmounted can invalidate its cached page, so remounting must fetch that
  // stale page instead of replaying the old snapshot.
  refetchOnMount: true,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: 30 * 1000,
} as const;

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
  const queryKey = ["post-feed", feedKey, user?.id ?? "guest"];

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

  // Track the newest id seen so far so a background poll can surface a "new
  // posts" pill without touching the feed's data (or the user's scroll
  // position) until they tap it.
  const newestIdRef = useRef<string | null>(null);
  const [newPosts, setNewPosts] = useState<PostData[]>([]);
  const feedRootRef = useRef<HTMLDivElement>(null);

  // Baseline to the newest post currently showing. Re-running whenever posts
  // change (tab switches, refetches, re-orders) keeps the ref aligned with
  // what the user is actually seeing, so a re-ordered or refetched feed never
  // false-triggers the "new posts" pill.
  useEffect(() => {
    if (posts.length > 0) {
      newestIdRef.current = posts[0].id;
    }
  }, [posts]);

  // Poll quietly every 45s for the newest post id only. When a brand-new post
  // appears, reveal the pill; the feed itself is left alone so the user's
  // scroll position never jumps out from under them. Only the main home feed
  // polls - the related-posts feed on a post page (excludePostId) shouldn't
  // surface a pill over content it is not the active view for.
  useEffect(() => {
    if (excludePostId) {
      return;
    }
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const fresh = await kyInstance.get(endpoint).json<PostsPage>();
          const newest = fresh.posts[0]?.id;
          if (newest && newest !== newestIdRef.current) {
            newestIdRef.current = newest;
            const knownIds = new Set(posts.map((p) => p.id));
            const unseenPosts: PostData[] = [];
            for (const post of fresh.posts) {
              if (knownIds.has(post.id)) {
                break;
              }
              unseenPosts.push(post);
            }
            if (unseenPosts.length > 0) {
              setNewPosts(unseenPosts);
            }
          }
        } catch {
          // Best-effort polling; ignore transient failures
        }
      })();
    }, 45 * 1000);
    return () => window.clearInterval(interval);
  }, [endpoint, posts, excludePostId]);

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  // Pull the freshly polled posts into the feed: refetch so they land at the
  // top, then scroll the nearest scrollable ancestor back up to meet them.
  const showNewPosts = useCallback(async () => {
    setNewPosts([]);
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
