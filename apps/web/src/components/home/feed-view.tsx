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
import { filterFeedPosts } from "@/lib/posts/feed-cache";
import { normalizePostsData } from "@/lib/posts/post-normalize";

import { groupPostsIntoThreads } from "./feed-thread-group";
import PostCard from "./feedview/post-card";

const DEFAULT_FEED_CACHE_KEY: QueryKey = ["post-feed", "for-you"];

interface FeedViewProps {
  cacheKey?: QueryKey;
  // Extra ids to drop from the rendered feed, applied to both the server list
  // and every cache-synced update. Used when a leading segment already shows a
  // post that the trailing feed's own cache would reintroduce.
  excludeIds?: ReadonlySet<string>;
  excludePostId?: string;
  posts: PostData[];
  // Inside a community's own feed every post belongs to that community, so the
  // per-post a/<slug> attribution is redundant and is suppressed there.
  showCommunity?: boolean;
  // Ranked feeds (For-You, Trending) label a community post with a short
  // "Trending in a/<slug>" reason line; chronological feeds omit it.
  showCommunityReason?: boolean;
  sortBy?: "newest" | "server";
}

export const FeedView: React.FC<FeedViewProps> = ({
  posts: initialPosts,
  cacheKey = DEFAULT_FEED_CACHE_KEY,
  excludeIds,
  excludePostId,
  showCommunity = true,
  showCommunityReason = false,
  sortBy = "newest",
}) => {
  const MemoizedPostCard = useMemo(() => React.memo(PostCard), []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const normalizedInitial = useMemo(
    () =>
      normalizePostsData(initialPosts ?? []).filter(
        (post) => !excludeIds?.has(post.id)
      ),
    [initialPosts, excludeIds]
  );
  const [posts, setPosts] = useState<PostData[]>(normalizedInitial);
  // Posts the viewer dismissed with "Not interested" this session. Kept out of
  // every rebuild of `posts`, including the prop-sync below and any refetch
  // that reintroduces them.
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

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
          const updatedPosts = filterFeedPosts(
            normalizePostsData(
              feedQueries.flatMap(
                ([, data]) => data?.pages?.flatMap((page) => page.posts) || []
              )
            ),
            { dismissedIds, excludeIds, excludePostId }
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
  }, [cacheKey, dismissedIds, excludeIds, excludePostId, queryClient]);

  useEffect(() => {
    const handleNotInterested = (event: Event) => {
      const { detail } = event as CustomEvent<{ postId?: string }>;
      const postId = detail?.postId;
      if (!postId) {
        return;
      }
      // Remember the dismissal locally. The cache and local list are both
      // filtered below, but the prop-sync reconciliation (and any refetch that
      // reintroduces the post) rebuilds `posts` from the server props, which
      // still contain it - so without this set the post reappeared immediately
      // when it happened to be the feed's first item. Filtering by this set in
      // `sortedPosts` keeps it hidden for the session regardless.
      setDismissedIds((current) =>
        current.has(postId) ? current : new Set([...current, postId])
      );
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
    // Undo: drop the local dismissal and put the post back into the cache so it
    // reappears in place without a refetch.
    const handleInterested = (event: Event) => {
      const { detail } = event as CustomEvent<{ postId?: string }>;
      const postId = detail?.postId;
      if (!postId) {
        return;
      }
      setDismissedIds((current) => {
        if (!current.has(postId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    };

    window.addEventListener(
      "recommendation:not-interested",
      handleNotInterested
    );
    window.addEventListener("recommendation:interested", handleInterested);
    return () => {
      window.removeEventListener(
        "recommendation:not-interested",
        handleNotInterested
      );
      window.removeEventListener("recommendation:interested", handleInterested);
    };
  }, [cacheKey, queryClient]);

  // Mirrors the last inputs seen by the prop-sync check below so fresh server
  // posts are adopted during render (the documented adjust-state pattern)
  // instead of from a cascading effect.
  const [syncInputs, setSyncInputs] = useState<{
    excludeIds: ReadonlySet<string> | undefined;
    excludePostId: string | undefined;
    initialPosts: PostData[];
    posts: PostData[];
  } | null>(null);

  if (
    syncInputs === null ||
    syncInputs.excludeIds !== excludeIds ||
    syncInputs.excludePostId !== excludePostId ||
    syncInputs.initialPosts !== normalizedInitial ||
    syncInputs.posts !== posts
  ) {
    const safeInitial = filterFeedPosts(normalizedInitial || [], {
      dismissedIds,
      excludeIds,
      excludePostId,
    });
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
        excludeIds,
        excludePostId,
        initialPosts: normalizedInitial,
        posts: uniquePosts,
      });
      setPosts(uniquePosts);
    } else {
      setSyncInputs({
        excludeIds,
        excludePostId,
        initialPosts: normalizedInitial,
        posts,
      });
    }
  }

  const sortedPosts = useMemo(() => {
    const filtered = filterFeedPosts(posts, { dismissedIds, excludeIds });
    if (sortBy === "server") {
      return filtered;
    }
    return filtered.toSorted(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [posts, excludeIds, dismissedIds, sortBy]);

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
                  showCommunity={showCommunity}
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
