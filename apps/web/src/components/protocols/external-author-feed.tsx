"use client";

import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useFeedRecovery } from "@/hooks/feed/use-feed-recovery";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";
import { readAuthorFeedWindow } from "@/lib/protocols/read-author-feed";
import { readProtocolResource } from "@/lib/protocols/read-resource";

import { BlueskyPostCard } from "./bluesky-post-card";

export function ExternalAuthorFeed({
  actor,
  tab,
}: {
  actor: string;
  tab: "posts" | "replies" | "media";
}) {
  const { user } = useSession();
  const network = useNetworkSettings();
  const client = useQueryClient();
  const queryKey = [
    "bluesky-author-feed",
    actor,
    tab,
    user?.id ?? "guest",
    network.scope,
  ];
  const query = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: network.ready,
    getNextPageParam: (
      page: Awaited<ReturnType<typeof readAuthorFeedWindow>>
    ) => page.cursor ?? undefined,
    initialPageParam: null as string | null,
    maxPages: 20,
    queryFn: ({ pageParam, signal }) => {
      const current = client.getQueryData<{
        pages: Awaited<ReturnType<typeof readAuthorFeedWindow>>[];
        pageParams: (string | null)[];
      }>(queryKey);
      const index = current?.pageParams.indexOf(pageParam) ?? -1;
      const previous =
        index >= 0 ? current?.pages.slice(0, index) : current?.pages;
      const known = new Set(
        previous?.flatMap((page) => page.items.map((post) => post.id))
      );
      return readAuthorFeedWindow(
        async (cursor) => {
          const params = new URLSearchParams({ actor, limit: "40", tab });
          if (cursor) {
            params.set("cursor", cursor);
          }
          return await readProtocolResource(
            `/api/protocols/bluesky/profile?${params}`,
            signal
          );
        },
        pageParam,
        known
      );
    },
    queryKey,
    retry: false,
  });
  useFeedRecovery({
    enabled: Boolean(query.data) && Boolean(query.hasNextPage),
    failed: query.isError,
    fetching: query.isFetching,
    resetKey: JSON.stringify(queryKey),
    retry: () => query.fetchNextPage({ cancelRefetch: false }),
    updatedAt: query.dataUpdatedAt,
  });
  if (query.isPending) {
    return <FeedViewSkeleton />;
  }
  if (query.isError && !query.data) {
    return (
      <FeedErrorState
        message="Couldn't load this account’s posts."
        isRetrying={query.isFetching}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const posts = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((post) => [post.id, post])
    ).values(),
  ];
  return (
    <InfiniteScrollContainer
      onBottomReached={() => {
        if (query.hasNextPage && !query.isFetching) {
          void query.fetchNextPage();
        }
      }}
    >
      {posts.map((post, index) => (
        <Fragment key={post.id}>
          {index > 0 ? <Separator className="bg-border/60" /> : null}
          <BlueskyPostCard post={post} />
        </Fragment>
      ))}
      {posts.length ? null : (
        <p className="text-muted-foreground px-4 py-10 text-center text-sm">
          No posts to show here.
        </p>
      )}
      {query.isFetchingNextPage ? <LoadMoreSkeleton /> : null}
      {query.isError ? (
        <FeedErrorState
          compact
          message="Couldn’t load more posts from this profile."
          isRetrying={query.isFetching}
          onRetry={() => {
            void query.fetchNextPage({ cancelRefetch: false });
          }}
        />
      ) : null}
      {query.hasNextPage ? (
        <Button
          className="mx-auto my-4 block"
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage();
          }}
          variant="premium-neutral"
        >
          Load more posts
        </Button>
      ) : null}
    </InfiniteScrollContainer>
  );
}
