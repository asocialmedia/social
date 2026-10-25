"use client";

import type { PostsPage } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalPostSchema,
  filterExternalRecommendations,
} from "@asm/protocols/discovery";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import { FeedView } from "@/components/home/feed-view";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import PostsOnlyLoadingSkeleton from "@/components/layouts/skeletons/post-only-loading-skeleton";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import kyInstance from "@/lib/ky";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";
import { readProtocolResource } from "@/lib/protocols/read-resource";
import {
  useExternalExclusions,
  useFeedSourceStore,
} from "@/store/feed-source-store";

const externalPageSchema = z.object({
  cursor: z.string().nullable(),
  items: z.array(externalPostSchema).max(50),
});

interface HashtagFeedProps {
  initialGuestPage?: PostsPage;
  tag: string;
}

export default function HashtagFeed({
  tag,
  initialGuestPage,
}: HashtagFeedProps) {
  const { user } = useSession();
  const network = useNetworkSettings();
  const source = useFeedSourceStore((state) => state.source);
  const showNative = source !== "bluesky";
  const showRemote = source !== "asm";
  const excluded = useExternalExclusions(user?.id ?? "guest");
  const key = ["post-feed", "hashtag", tag, user?.id ?? "guest", network.scope];
  const native = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: network.ready && showNative,
    getNextPageParam: (lastPage: PostsPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    placeholderData:
      !user && initialGuestPage
        ? { pageParams: [null], pages: [initialGuestPage] }
        : undefined,
    queryFn: ({ pageParam, signal }) =>
      kyInstance
        .get(`/api/hashtags/${encodeURIComponent(tag)}/posts`, {
          searchParams: pageParam ? { cursor: pageParam } : {},
          signal,
        })
        .json<PostsPage>(),
    queryKey: key,
  });
  const remote = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: network.ready && showRemote,
    getNextPageParam: (page: {
      items: ExternalPost[];
      cursor: string | null;
    }) => page.cursor,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ tag });
      if (pageParam) {
        params.set("cursor", pageParam);
      }
      return externalPageSchema.parse(
        await readProtocolResource(
          `/api/protocols/bluesky/hashtag?${params}`,
          signal
        )
      );
    },
    queryKey: ["bluesky-hashtag", tag, user?.id ?? "guest", network.scope],
    retry: false,
  });
  const posts = showNative
    ? (native.data?.pages.flatMap((page) => page.posts) ?? [])
    : [];
  const external = filterExternalRecommendations(
    showRemote ? (remote.data?.pages.flatMap((page) => page.items) ?? []) : [],
    excluded
  );
  const pending =
    (showNative && native.isPending) || (showRemote && remote.isPending);
  const hasContent = posts.length > 0 || external.length > 0;
  const fetching =
    (showNative && native.isFetching) || (showRemote && remote.isFetching);
  const next =
    (showNative && native.hasNextPage) || (showRemote && remote.hasNextPage);
  const failed =
    (showNative && native.isError) || (showRemote && remote.isError);
  const loadMore = useCallback(() => {
    if (
      showNative &&
      native.hasNextPage &&
      !native.isFetching &&
      !native.isError
    ) {
      void native.fetchNextPage();
    }
    if (
      showRemote &&
      remote.hasNextPage &&
      !remote.isFetching &&
      !remote.isError
    ) {
      void remote.fetchNextPage();
    }
  }, [native, remote, showNative, showRemote]);
  if (!hasContent && pending) {
    return <PostsOnlyLoadingSkeleton />;
  }
  if (!hasContent && !failed && !next) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="font-medium">No posts found for #{tag}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Be the first to rustle something about this topic.
        </p>
      </div>
    );
  }
  return (
    <InfiniteScrollContainer
      onBottomReached={loadMore}
      prefetchDistance={800}
      continuationDelay={hasContent ? 0 : 800}
    >
      <FeedView
        posts={posts}
        externalPosts={external}
        source={source}
        cacheKey={key}
        sortBy="newest"
        showEmpty={false}
      />
      {failed ? (
        <FeedErrorState
          compact={hasContent}
          message={
            hasContent
              ? "Some posts couldn't load. Please try again."
              : "We couldn't load posts for this hashtag. Please try again."
          }
          isRetrying={fetching}
          onRetry={() => {
            if (showNative && native.isError) {
              void (native.isFetchNextPageError
                ? native.fetchNextPage()
                : native.refetch());
            }
            if (showRemote && remote.isError) {
              void (remote.isFetchNextPageError
                ? remote.fetchNextPage()
                : remote.refetch());
            }
          }}
        />
      ) : null}
      {fetching && (hasContent || next) ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
}
