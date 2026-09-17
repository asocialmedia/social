"use client";

import type { PostData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import {
  forceInvalidatePostFeeds,
  repairStalePostCaches,
} from "@/lib/posts/cache-sync";
import { normalizePostsData } from "@/lib/posts/post-normalize";

import { groupPostsIntoThreads } from "./feed-thread-group";
import PostCard from "./feedview/post-card";

const DEFAULT_FEED_CACHE_KEY: QueryKey = ["post-feed", "for-you"];

interface FeedViewProps {
  cacheKey?: QueryKey;
  excludePostId?: string;
  posts: PostData[];
  // Ranked feeds (For-You, Trending) label a community post with a short
  // "Trending in a/<slug>" reason line; chronological feeds omit it.
  showCommunityReason?: boolean;
  sortBy?: "newest" | "server";
}

export const FeedView: React.FC<FeedViewProps> = ({
  posts: initialPosts,
  cacheKey = DEFAULT_FEED_CACHE_KEY,
  excludePostId,
  showCommunityReason = false,
  sortBy = "newest",
}) => {
  const MemoizedPostCard = useMemo(() => React.memo(PostCard), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const normalizedInitial = useMemo(
    () => normalizePostsData(initialPosts ?? []),
    [initialPosts]
  );
  const [posts, setPosts] = useState<PostData[]>(normalizedInitial);

  // Self-heal: stale `post.bookmarks` entries (pre-fix cache, persisted SSR
  // props, or optimistic drafts) crash `post.bookmarks.some` in production.
  // Patch them synchronously to `[]` so the render never throws, then
  // revalidate the server Data Cache (Next.js `use cache` / `fetchCache`) and
  // React Query feeds in the background. This respects `cacheComponents: true`
  // (`app` default) - `router.refresh()` revalidates the `use cache` segments
  // and `fetchCache` routes, while `forceInvalidatePostFeeds` refetches the
  // client `post-feed` queries that hydrated from `hydrateViewCounts`.
  useEffect(() => {
    const didRepair = repairStalePostCaches(queryClient);
    if (didRepair) {
      forceInvalidatePostFeeds(queryClient);
      router.refresh();
    }
  }, [queryClient, router]);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      setTimeout(() => {
        const feedQueries = queryClient.getQueriesData<{
          pages: { posts: PostData[] }[];
        }>({
          queryKey: cacheKey,
        });

        if (feedQueries.length > 0) {
          const updatedPosts = normalizePostsData(
            feedQueries
              .flatMap(([, data]) =>
                (data?.pages?.flatMap((page) => page.posts) || []).filter(
                  Boolean
                )
              )
              .filter((post) => post.id !== excludePostId)
          );

          if (updatedPosts.length) {
            const uniquePosts = [
              ...new Map(updatedPosts.map((post) => [post.id, post])).values(),
            ];
            // eslint-disable-next-line react-compiler -- reflect cache updates into local feed state
            setPosts(uniquePosts);
          }
        }
      }, 0);
    });

    return () => {
      unsubscribe();
    };
  }, [cacheKey, excludePostId, queryClient]);

  useEffect(() => {
    const handleNotInterested = (event: Event) => {
      const { detail } = event as CustomEvent<{ postId?: string }>;
      const postId = detail?.postId;
      if (!postId) {
        return;
      }
      setPosts((current) => current.filter((post) => post.id !== postId));
      queryClient.setQueriesData<{
        pageParams: unknown[];
        pages: { posts: PostData[] }[];
      }>({ queryKey: cacheKey }, (data) => {
        if (!data) {
          return data;
        }
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            posts: page.posts.filter((post) => post.id !== postId),
          })),
        };
      });
    };
    window.addEventListener(
      "recommendation:not-interested",
      handleNotInterested
    );
    return () => {
      window.removeEventListener(
        "recommendation:not-interested",
        handleNotInterested
      );
    };
  }, [cacheKey, queryClient]);

  // Mirrors the last inputs seen by the prop-sync check below so fresh server
  // posts are adopted during render (the documented adjust-state pattern)
  // instead of from a cascading effect.
  const [syncInputs, setSyncInputs] = useState<{
    excludePostId: string | undefined;
    initialPosts: PostData[];
    posts: PostData[];
  } | null>(null);

  if (
    syncInputs === null ||
    syncInputs.excludePostId !== excludePostId ||
    syncInputs.initialPosts !== normalizedInitial ||
    syncInputs.posts !== posts
  ) {
    const safeInitial = (normalizedInitial || [])
      .filter(Boolean)
      .filter((post) => post.id !== excludePostId);
    const initialFirstId = safeInitial[0]?.id;
    const currentFirstId = posts[0]?.id;
    if (
      safeInitial.length > 0 &&
      (posts.length === 0 ||
        (initialFirstId && currentFirstId !== initialFirstId))
    ) {
      const uniquePosts = [
        ...new Map(safeInitial.map((post) => [post.id, post])).values(),
      ];
      setSyncInputs({
        excludePostId,
        initialPosts: normalizedInitial,
        posts: uniquePosts,
      });
      setPosts(uniquePosts);
    } else {
      setSyncInputs({ excludePostId, initialPosts: normalizedInitial, posts });
    }
  }

  const sortedPosts = useMemo(() => {
    if (sortBy === "server") {
      return [...posts].filter(Boolean);
    }
    return [...posts]
      .filter(Boolean)
      .toSorted(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [posts, sortBy]);

  const threadGroups = useMemo(
    () => groupPostsIntoThreads(sortedPosts),
    [sortedPosts]
  );

  return (
    <div className="flex flex-col">
      {threadGroups.map((group) => (
        <div className="flex flex-col" key={group.id}>
          {group.posts.map((post, index) => {
            const isFirst = index === 0;
            const isLast = index === group.posts.length - 1;
            const hasThreadParent = !isFirst;
            const hasThreadChild = !isLast;

            return (
              <RecommendationTracker key={post.id} postId={post.id}>
                <MemoizedPostCard
                  hasThreadChild={hasThreadChild}
                  hasThreadParent={hasThreadParent}
                  isJoined={true}
                  post={post}
                  showCommunityReason={showCommunityReason}
                />
              </RecommendationTracker>
            );
          })}
          <Separator className="bg-border/60" />
        </div>
      ))}
      {threadGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 sm:py-8">
          <p className="text-muted-foreground text-center text-sm sm:text-base">
            No posts to show here. Follow someone or create your first post.
          </p>
        </div>
      )}
    </div>
  );
};
