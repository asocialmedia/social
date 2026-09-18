"use client";

import type { PostsPage } from "@asm/db";
import noFeedImage from "@assets/general/nofeed.png";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import kyInstance from "@/lib/ky";
import {
  nextFeedSegment,
  splitCommunityFirstSegments,
} from "@/lib/posts/community-first-feed";
import {
  FEED_QUERY_BEHAVIOR,
  prependPostsToFeedCache,
  scrollFeedToTop,
} from "@/lib/posts/feed-cache";

import { FeedView } from "./feed-view";
import FeedEnd from "./feedview/feed-end";

interface HomeFeedProps {
  // When set, the community's own posts lead the feed and the global feed
  // follows once they run out (or the lead segment caps out). Used on a
  // community post's detail page so "more content" stays inside the community
  // before opening up to the wider platform.
  communitySlug?: string;
  excludePostId?: string;
  variant?: "latest" | "personalized" | "trending" | "global";
}

// How many community pages lead the feed before the global feed takes over.
// Without a cap a large community would page forever and the platform posts
// would never surface; two pages (40 posts) is enough context to read as
// "more from this community" without starving the global segment.
const COMMUNITY_LEAD_PAGE_LIMIT = 2;

// Named export kept for the feed-behavior test; the values live in the shared
// feed-cache module so Following and Gusts cannot drift from it.
export const HOME_FEED_QUERY_BEHAVIOR = FEED_QUERY_BEHAVIOR;

// Flattens infinite pages into a unique post list, dropping the current post.
// Rank shifts between paginated refetches can land the same post on two pages
// (tail of one, head of the next); React keys demand uniqueness.
function flattenUniquePosts(
  pages: PostsPage[] | undefined,
  excludePostId: string | undefined
) {
  const list = (pages?.flatMap((page) => page.posts) || [])
    .filter(Boolean)
    .filter((post) => post.id !== excludePostId);
  return [...new Map(list.map((post) => [post.id, post])).values()];
}

export default function HomeFeed({
  variant = "personalized",
  excludePostId,
  communitySlug,
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

  // The community segment reuses the community feed's exact query key, so the
  // page shares one cache entry with the community page's own feed (no separate
  // fetch when moving between them). Declared before the global query so the
  // global one can wait on the community segment's state.
  const communityQueryKey = useMemo(
    () => ["community-feed", communitySlug ?? "", "new"],
    [communitySlug]
  );
  const {
    data: communityData,
    fetchNextPage: fetchNextCommunityPage,
    hasNextPage: communityHasNextPage,
    isFetchingNextPage: isFetchingNextCommunityPage,
    status: communityStatus,
  } = useInfiniteQuery({
    enabled: Boolean(communitySlug),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(`/api/communities/${communitySlug}/posts`, {
          searchParams: {
            sort: "new",
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        })
        .json<PostsPage>(),
    queryKey: communityQueryKey,
    ...HOME_FEED_QUERY_BEHAVIOR,
  });

  const communityPosts = useMemo(
    () => flattenUniquePosts(communityData?.pages, excludePostId),
    [communityData?.pages, excludePostId]
  );
  const hasCommunityLead = Boolean(communitySlug) && communityPosts.length > 0;
  // The community segment yields to the global feed once it runs out of pages
  // or hits the lead cap.
  const communityExhausted =
    !communitySlug ||
    communityPosts.length === 0 ||
    (communityData?.pages.length ?? 0) >= COMMUNITY_LEAD_PAGE_LIMIT ||
    communityHasNextPage === false;
  const communityStillLeading = hasCommunityLead && !communityExhausted;

  // The global feed is held back until the community segment is done, so its
  // first page cannot render under the community posts and then get shunted
  // down when a later community page loads in above it.
  const globalEnabled = !communitySlug || communityExhausted;
  const {
    data,
    fetchNextPage,
    hasNextPage: globalHasNextPage,
    isFetching,
    isFetchingNextPage: isFetchingNextGlobalPage,
    status: globalStatus,
  } = useInfiniteQuery({
    enabled: globalEnabled,
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

  const globalPosts = useMemo(
    () => flattenUniquePosts(data?.pages, excludePostId),
    [data?.pages, excludePostId]
  );
  // A post can sit in the community query and the global query's window at the
  // same time; the community copy already leads, so drop the duplicate.
  const { communityPosts: leadPosts, globalPosts: visibleGlobalPosts } =
    useMemo(
      () =>
        splitCommunityFirstSegments({
          communityPosts,
          globalPosts,
        }),
      [communityPosts, globalPosts]
    );
  const communityIds = useMemo(
    () => new Set(leadPosts.map((post) => post.id)),
    [leadPosts]
  );

  // The first global fetch after the community segment finishes; counted as a
  // pending page so the end-of-feed marker does not flash before it lands.
  const globalInitialLoading = globalEnabled && globalStatus === "pending";
  const hasNextPage =
    communityStillLeading || globalInitialLoading || Boolean(globalHasNextPage);

  const queryClient = useQueryClient();
  const feedRootRef = useRef<HTMLDivElement>(null);

  // Head-only probe: new posts from other people collect in `newPosts` and are
  // surfaced as an avatar badge. The rendered feed and its scroll position stay
  // exactly where they are until the viewer taps the badge. The probe is about
  // the global feed, so it stays off while a community segment leads.
  const { clearNewItems, newItems: newPosts } = useNewContentProbe({
    enabled: !excludePostId && !communitySlug,
    fetchHead: async () => {
      const fresh = await kyInstance.get(endpoint).json<PostsPage>();
      return fresh.posts;
    },
    visible: globalPosts,
  });

  const handleBottomReached = useCallback(() => {
    const segment = nextFeedSegment({
      communityExhausted,
      globalHasNextPage: Boolean(globalHasNextPage),
      hasCommunityLead,
    });
    if (segment === "community") {
      if (!isFetchingNextCommunityPage) {
        fetchNextCommunityPage();
      }
      return;
    }
    if (segment === "global" && !isFetching) {
      fetchNextPage();
    }
  }, [
    communityExhausted,
    fetchNextCommunityPage,
    fetchNextPage,
    globalHasNextPage,
    hasCommunityLead,
    isFetching,
    isFetchingNextCommunityPage,
  ]);

  // Merge the probed posts straight into the head of the cached feed, then
  // bring the viewer up to meet them. No refetch and no skeleton: the feed is
  // already on screen, we only reveal what the probe found.
  const showNewPosts = useCallback(() => {
    clearNewItems();
    prependPostsToFeedCache(queryClient, queryKey, newPosts);
    scrollFeedToTop(feedRootRef.current);
  }, [clearNewItems, newPosts, queryClient, queryKey]);

  // A community segment that is still loading leads the render; a failed
  // community fetch degrades to the global feed rather than blanking the page,
  // and a failed global fetch never hides a community segment that loaded.
  const communityPending =
    Boolean(communitySlug) && communityStatus === "pending";
  const communityFailed = Boolean(communitySlug) && communityStatus === "error";
  const showCommunitySection = hasCommunityLead && !communityFailed;
  const hasAnyPosts = showCommunitySection || visibleGlobalPosts.length > 0;

  // Block on a skeleton only while nothing at all can be shown yet: a resolved
  // community segment renders immediately even if the global feed is still in
  // flight behind it.
  if (!hasAnyPosts && (communityPending || globalStatus === "pending")) {
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

  if (!hasAnyPosts && !hasNextPage && globalStatus === "success") {
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

  if (!hasAnyPosts && globalStatus === "error") {
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

  const isFetchingNextPage =
    isFetchingNextCommunityPage ||
    isFetchingNextGlobalPage ||
    globalInitialLoading;

  return (
    <div className="relative" ref={feedRootRef}>
      {!excludePostId && !communitySlug && newPosts.length > 0 ? (
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
        {/* Community segment leads. `showCommunity={false}` because every post
            here already belongs to the community being read. */}
        {showCommunitySection ? (
          <FeedView
            cacheKey={communityQueryKey}
            excludePostId={excludePostId}
            posts={leadPosts}
            showCommunity={false}
            sortBy="server"
          />
        ) : null}
        {/* The hand-off between the community and the platform. Only rendered
            when both segments actually have posts on screen. */}
        {showCommunitySection && visibleGlobalPosts.length > 0 ? (
          <h3 className="text-muted-foreground border-border/60 border-t px-4 pt-4 pb-2 text-xs font-semibold tracking-wide uppercase">
            More from asocialmedia
          </h3>
        ) : null}
        {visibleGlobalPosts.length > 0 ? (
          <FeedView
            cacheKey={queryKey}
            excludeIds={communityIds}
            excludePostId={excludePostId}
            posts={visibleGlobalPosts}
            showCommunityReason={isTrending || isPersonalized}
            sortBy={isTrending || isPersonalized ? "server" : "newest"}
          />
        ) : null}
        {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
        {hasAnyPosts && !hasNextPage ? <FeedEnd /> : null}
      </InfiniteScrollContainer>
    </div>
  );
}
