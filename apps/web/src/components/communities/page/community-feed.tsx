"use client";

import type { PostsPage } from "@asm/db";
import {
  communityFeedSearchParams,
  communityPostFilterCount,
  readCommunityFeedSelection,
} from "@asm/db/communities";
import type { CommunityFeedSelection } from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import errorImage from "@assets/general/error.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { FeedView } from "@/components/home/feed-view";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import FeedEnd from "@/components/home/feedview/feed-end";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import EmptyFeedState from "@/components/profile/empty-feed-state";
import kyInstance from "@/lib/ky";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";

import CommunityPostFilters, {
  CommunityPostFilterSummary,
} from "./community-post-filters";

// The community's own feed. Native posts only, sorted by new or top. Reuses
// the global FeedView so the card, media, voting and comments behave exactly
// as they do everywhere else.
export default function CommunityFeed({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const selection = readCommunityFeedSelection(searchParams);
  const { sort } = selection;
  const filterParams = communityFeedSearchParams(selection).toString();
  const filtered = communityPostFilterCount(selection) > 0;
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const queryKey = useMemo(
    () => ["community-feed", slug, sort, filterParams],
    [slug, sort, filterParams]
  );
  const updateSelection = useCallback(
    (next: CommunityFeedSelection) => {
      const params = communityFeedSearchParams(next, searchParams.toString());
      const target = `${pathname}${params.size ? `?${params}` : ""}`;
      if (target !== `${window.location.pathname}${window.location.search}`) {
        window.history.pushState(null, "", target);
      }
    },
    [pathname, searchParams]
  );
  useEffect(() => {
    feedScrollRef.current?.scrollTo({ top: 0 });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new selection resets the scrolling viewport even when its element is reused.
  }, [filterParams, slug]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({
      pageParam,
      signal,
    }: {
      pageParam: string | null;
      signal: AbortSignal;
    }) =>
      kyInstance
        .get(`/api/communities/${slug}/posts`, {
          searchParams: {
            ...Object.fromEntries(new URLSearchParams(filterParams)),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
          signal,
        })
        .json<PostsPage>(),
    queryKey,
    ...FEED_QUERY_BEHAVIOR,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const handleSortChange = (value: string) =>
    updateSelection({ ...selection, sort: value === "top" ? "top" : "new" });

  let body: React.ReactNode;
  if (status === "pending") {
    body = <FeedViewSkeleton />;
  } else if (status === "error") {
    body = (
      <EmptyFeedState
        action={
          <Button
            className="h-8 gap-1.5 px-3.5! py-0! text-xs!"
            onClick={() => refetch()}
            variant="premium"
          >
            Try again
          </Button>
        }
        description="Something went wrong loading this community's posts."
        image={errorImage}
        title="Couldn't load posts"
      />
    );
  } else if (posts.length === 0) {
    body = (
      <EmptyFeedState
        description={
          filtered
            ? "Try a different combination or clear your filters."
            : "Be the first to post here."
        }
        title={filtered ? "No posts match these filters" : "No posts yet"}
        action={
          filtered ? (
            <Button
              variant="premium-neutral"
              className="min-h-11"
              onClick={() =>
                updateSelection({
                  ...readCommunityFeedSelection(new URLSearchParams()),
                  sort,
                })
              }
            >
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <InfiniteScrollContainer
        onBottomReached={() =>
          hasNextPage && !isFetchingNextPage && fetchNextPage()
        }
      >
        {/* Every post here belongs to this community, so the per-post a/<slug>
            attribution is suppressed; it only earns its place outside the
            community, on the global/ranked feeds. */}
        <FeedView
          cacheKey={queryKey}
          posts={posts}
          showCommunity={false}
          sortBy="server"
        />
        {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
        {hasNextPage ? null : <FeedEnd />}
      </InfiniteScrollContainer>
    );
  }

  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={handleSortChange}
      value={sort}
    >
      <div className="border-border/60 flex items-center justify-between gap-2 border-b pr-3">
        <TabsList className="flex h-full items-center gap-0 bg-transparent p-0">
          <AnimatedTabTrigger
            active={sort === "new"}
            layoutId={`community-tab-${slug}`}
            value="new"
          >
            New
          </AnimatedTabTrigger>
          <AnimatedTabTrigger
            active={sort === "top"}
            layoutId={`community-tab-${slug}`}
            value="top"
          >
            Top
          </AnimatedTabTrigger>
        </TabsList>
        <CommunityPostFilters
          selection={selection}
          onChange={updateSelection}
        />
      </div>
      <CommunityPostFilterSummary
        selection={selection}
        onChange={updateSelection}
      />

      <div className="relative min-h-0 flex-1">
        <div className="relative h-full">
          <div
            className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto pb-24 lg:pb-0"
            ref={feedScrollRef}
          >
            <TabsContent className="mt-0" value="new">
              {body}
            </TabsContent>
            <TabsContent className="mt-0" value="top">
              {body}
            </TabsContent>
          </div>
          <FeedScrollbar containerRef={feedScrollRef} />
        </div>
      </div>
    </Tabs>
  );
}
