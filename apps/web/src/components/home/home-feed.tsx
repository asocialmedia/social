"use client";

import type { PostsPage } from "@asm/db";
import type { FeedSource } from "@asm/protocols/discovery";
import {
  discoveryMode,
  feedAvailability,
  filterExternalRecommendations,
  isExternalTrendingPost,
} from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import noFeedImage from "@assets/general/nofeed.png";
import {
  hashKey,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useBlueskyFeed } from "@/components/protocols/use-bluesky-feed";
import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import { useSeamlessFeedHead } from "@/hooks/feed/use-seamless-feed-head";
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
import { activeNetworkInterests } from "@/lib/posts/network-content-policy";
import { isTrendingPost } from "@/lib/posts/trending-eligibility";
import {
  useFeedSourceStore,
  useExternalExclusions,
} from "@/store/feed-source-store";

import { FeedView } from "./feed-view";
import FeedEnd from "./feedview/feed-end";

interface HomeFeedProps {
  // When set, the community's own posts lead the feed and the global feed
  // follows once they run out (or the lead segment caps out). Used on a
  // community post's detail page so "more content" stays inside the community
  // before opening up to the wider platform.
  communitySlug?: string;
  excludePostId?: string;
  relatedExternal?: boolean;
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

// Only the chronological feed orders by recency, and only there is the top row
// a reliable "did anything arrive?" signal: a post published a second ago is
// always the top row. A RANKED feed (for-you, trending) can hold the exact same
// top row while a new post lands at position eight, so asking it for one row -
// and then treating "same top id" as "nothing new" - would hide the arrival the
// probe exists to catch. Ranked feeds probe the full head page and diff it as a
// set instead; the one-row shortcut stays a latest-feed optimization.
//
// Exported (like HOME_FEED_QUERY_BEHAVIOR) so the test can pin the rule rather
// than a comment.
export function probeOrdersNewestFirst(
  variant: HomeFeedProps["variant"]
): boolean {
  return variant === "latest";
}

export function feedIsRanked(variant: HomeFeedProps["variant"]): boolean {
  return (
    variant === "personalized" || variant === "global" || variant === "trending"
  );
}

export default function HomeFeed({
  variant = "personalized",
  excludePostId,
  communitySlug,
  relatedExternal = false,
}: HomeFeedProps) {
  const { user } = useSession();
  const selectedSource = useFeedSourceStore((state) => state.source);
  const excluded = useExternalExclusions(user?.id ?? "guest");
  const allowExternal = !communitySlug && (!excludePostId || relatedExternal);
  let source = allowExternal ? selectedSource : "asm";
  if (relatedExternal) {
    source = "all";
  }
  const includeBluesky = source !== "asm";
  const external = useBlueskyFeed(
    discoveryMode(variant),
    allowExternal && includeBluesky,
    user?.id ?? "guest"
  );
  const externalPosts = useMemo(
    () =>
      filterExternalRecommendations(
        external.data?.pages.flatMap((page) => page.items) ?? [],
        excluded
      ).filter(
        (post) =>
          post.id !== excludePostId &&
          (variant !== "trending" || isExternalTrendingPost(post))
      ),
    [external.data, excluded, excludePostId, variant]
  );
  const isTrending = variant === "trending";
  const network = useNetworkSettings();
  const { locale } = useDiscoveryLocale();
  const networkParams = {
    locale,
    network: network.scope,
    profile: network.settings.preferences.activeProfileId,
  };
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
  const isRankedFeed = feedIsRanked(variant);
  const probeSupportsSingleRow = probeOrdersNewestFirst(variant);
  const queryKey = useMemo(() => {
    const key = [
      "post-feed",
      feedKey,
      user?.id ?? "guest",
      network.scope,
      locale,
    ];
    if (isTrending) {
      key.push("engaged-v1");
    }
    return key;
  }, [feedKey, user?.id, network.scope, locale, isTrending]);

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
  // or hits the lead cap. An EMPTY list only counts as exhausted once the query
  // has SETTLED: while it is still loading the segment must not be judged
  // finished, or the global feed would start rendering underneath and then get
  // shoved down when community page one lands above it. An error, by contrast,
  // degrades straight to the global feed.
  let communityExhausted = true;
  if (communitySlug && communityStatus === "pending") {
    communityExhausted = false;
  } else if (communitySlug && communityStatus === "success") {
    communityExhausted =
      communityPosts.length === 0 ||
      (communityData?.pages.length ?? 0) >= COMMUNITY_LEAD_PAGE_LIMIT ||
      communityHasNextPage === false;
  }
  const communityStillLeading = hasCommunityLead && !communityExhausted;

  // The global feed is held back until the community segment is done, so its
  // first page cannot render under the community posts and then get shunted
  // down when a later community page loads in above it.
  const globalEnabled = !communitySlug || communityExhausted;
  const {
    data,
    fetchNextPage,
    hasNextPage: globalHasNextPage,
    isFetchedAfterMount,
    isFetching,
    isFetchingNextPage: isFetchingNextGlobalPage,
    status: globalStatus,
  } = useInfiniteQuery({
    enabled: globalEnabled && source !== "bluesky" && network.ready,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const result = await kyInstance
        .get(endpoint, {
          searchParams: {
            ...networkParams,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        })
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
  const globalInitialLoading =
    source !== "bluesky" && globalEnabled && globalStatus === "pending";
  const externalInitialLoading =
    allowExternal && includeBluesky && external.isPending;
  const hasNextPage =
    (source !== "bluesky" &&
      (communityStillLeading ||
        globalInitialLoading ||
        Boolean(globalHasNextPage))) ||
    (allowExternal && source !== "asm" && Boolean(external.hasNextPage));

  const queryClient = useQueryClient();
  const feedRootRef = useRef<HTMLDivElement>(null);

  // Head-only probe: new posts from other people collect in `newPosts` and are
  // surfaced as an avatar badge. The rendered feed and its scroll position stay
  // exactly where they are until the viewer returns to the top or taps the badge. The probe is about
  // the global feed, so it stays off while a community segment leads.
  const {
    clearNewItems,
    newItems: newPosts,
    probeNow,
  } = useNewContentProbe({
    enabled:
      network.ready &&
      globalStatus === "success" &&
      !excludePostId &&
      !communitySlug &&
      source !== "bluesky",
    eventSource: "asm",
    fetchHead: async (signal) => {
      // Cheap first, and only where it is sound: one row answers "did anything
      // arrive?" on a recency-ordered feed. The full head page - twenty
      // viewer-resolved posts, their vote and bookmark joins, and a view count
      // read for all twenty - is only worth fetching once that row says
      // something new, which on an idle screen is almost never. Same badge,
      // same merge, a fraction of the work per poll. A ranked feed skips the
      // shortcut and pays for the page, because its new post is not obliged to
      // be sitting at the top.
      if (probeSupportsSingleRow && globalPosts.length > 0) {
        const head = await kyInstance
          .get(endpoint, {
            searchParams: { ...networkParams, take: 1 },
            signal,
          })
          .json<PostsPage>();
        if (globalPosts.some((post) => post.id === head.posts[0]?.id)) {
          return [];
        }
      }
      let probeEndpoint = endpoint;
      if (isRankedFeed && !isTrending) {
        probeEndpoint = "/api/posts/latest";
      }
      const fresh = await kyInstance
        .get(probeEndpoint, {
          searchParams: networkParams,
          signal,
        })
        .json<PostsPage>();
      return isTrending ? fresh.posts.filter(isTrendingPost) : fresh.posts;
    },
    order: isRankedFeed ? "ranked" : "newest-first",
    // A cold fetch already supplies the head; cached returns need a probe.
    probeOnMount: !isFetchedAfterMount,
    resetKey: `${feedKey}:${user?.id ?? "guest"}:${network.scope}:${locale}`,
    visible: globalPosts,
  });

  const handleBottomReached = useCallback(
    (retry = false) => {
      if (
        allowExternal &&
        source !== "asm" &&
        external.hasNextPage &&
        !external.isFetching &&
        (!external.isError || retry)
      ) {
        void external.fetchNextPage({ cancelRefetch: false });
      }
      if (source === "bluesky") {
        return;
      }
      const segment = nextFeedSegment({
        communityExhausted,
        globalHasNextPage: Boolean(globalHasNextPage),
        hasCommunityLead,
      });
      if (segment === "community") {
        if (!isFetchingNextCommunityPage) {
          fetchNextCommunityPage({ cancelRefetch: false });
        }
        return;
      }
      if (segment === "global" && !isFetching) {
        fetchNextPage({ cancelRefetch: false });
      }
    },
    [
      allowExternal,
      source,
      external,
      communityExhausted,
      fetchNextCommunityPage,
      fetchNextPage,
      globalHasNextPage,
      hasCommunityLead,
      isFetching,
      isFetchingNextCommunityPage,
    ]
  );

  // Merge the probed posts straight into the head of the cached feed, then
  // bring the viewer up to meet them. No refetch and no skeleton: the feed is
  // already on screen, we only reveal what the probe found.
  // Merge the probed posts straight into the head of the cached feed, then
  // optionally bring the viewer up to meet them.
  const revealNewPosts = useCallback(
    (opts: { scrollToTop?: boolean } = {}) => {
      clearNewItems();
      prependPostsToFeedCache(queryClient, queryKey, newPosts);
      external.showNewItems();
      if (opts.scrollToTop) {
        scrollFeedToTop(feedRootRef.current);
      }
    },
    [clearNewItems, newPosts, queryClient, queryKey, external]
  );

  const showNewPosts = useCallback(() => {
    revealNewPosts({ scrollToTop: true });
  }, [revealNewPosts]);

  // A community segment that is still loading leads the render; a failed
  // community fetch degrades to the global feed rather than blanking the page,
  // and a failed global fetch never hides a community segment that loaded.
  const communityPending =
    Boolean(communitySlug) && communityStatus === "pending";
  const communityFailed = Boolean(communitySlug) && communityStatus === "error";
  const showCommunitySection = hasCommunityLead && !communityFailed;
  const hasAnyPosts =
    showCommunitySection ||
    (source !== "bluesky" && visibleGlobalPosts.length > 0) ||
    (allowExternal && source !== "asm" && externalPosts.length > 0);

  const availability = feedAvailability({
    count: hasAnyPosts ? 1 : 0,
    externalEnabled: allowExternal && includeBluesky,
    externalError: external.isError,
    externalLoading: external.isPending,
    nativeEnabled: source !== "bluesky",
    nativeError: communityFailed || globalStatus === "error",
    nativeLoading: communityPending || globalStatus === "pending",
  });
  useSeamlessFeedHead({
    count:
      (source === "bluesky" ? 0 : newPosts.length) +
      (source === "asm" ? 0 : external.newItems.length),
    enabled: !excludePostId && !communitySlug && hasAnyPosts,
    merge: () => revealNewPosts({ scrollToTop: false }),
    probe: () =>
      Promise.all([
        probeNow(),
        source === "asm" ? Promise.resolve() : external.probeNow(),
      ]),
    root: feedRootRef,
  });

  if (availability === "error") {
    return (
      <FeedErrorState
        message="Couldn’t load your feed. Please try again."
        onRetry={() => {
          void external.refetch();
          void queryClient.invalidateQueries({ queryKey });
        }}
      />
    );
  }

  // Block on a skeleton only while nothing at all can be shown yet: a resolved
  // community segment renders immediately even if the global feed is still in
  // flight behind it.
  if (availability === "loading") {
    return <FeedViewSkeleton source={source} />;
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
  if (activeNetworkInterests(network.settings.preferences).length) {
    emptyTitle = "No Fleets match this profile yet.";
    emptyDescription =
      "Try another profile or add interests in Network settings.";
  }

  if (!hasAnyPosts && !hasNextPage && globalStatus === "success") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          // This illustration IS the feed when there is nothing to show, so it
          // is the largest paint on an empty tab. Lazy-loading it makes the
          // empty state arrive after the copy beside it.
          loading="eager"
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
    (allowExternal && includeBluesky && external.isFetchingNextPage);
  const initialSourceLoading = globalInitialLoading || externalInitialLoading;
  const sourceFetching =
    (source !== "bluesky" && isFetching) ||
    (allowExternal && includeBluesky && external.isFetching);
  const sourceFailed =
    (source !== "bluesky" && (communityFailed || globalStatus === "error")) ||
    (allowExternal && includeBluesky && external.isError);
  const feedComplete =
    !hasNextPage &&
    !communityPending &&
    !initialSourceLoading &&
    !isFetchingNextPage &&
    !sourceFetching &&
    !sourceFailed;

  let nextSkeletonSource: FeedSource = "all";
  if (external.isFetchingNextPage) {
    nextSkeletonSource = "bluesky";
  } else if (isFetchingNextGlobalPage) {
    nextSkeletonSource = source;
  }

  return (
    <div className="relative" ref={feedRootRef}>
      {!excludePostId &&
      !communitySlug &&
      ((source !== "bluesky" && newPosts.length > 0) ||
        (source !== "asm" && external.newItems.length > 0)) ? (
        <div className="pointer-events-none sticky top-3 z-20 -mb-10 flex justify-center">
          <NewContentPill
            authors={[
              ...new Map([
                ...(source === "bluesky"
                  ? []
                  : newPosts.map(
                      (post) =>
                        [
                          post.userId,
                          {
                            avatarUrl: post.user?.avatarUrl,
                            id: post.userId,
                            username: post.user?.username,
                          },
                        ] as const
                    )),
                ...(source === "asm"
                  ? []
                  : external.newItems.map(
                      (post) =>
                        [
                          post.author.id,
                          {
                            avatarUrl: post.author.avatarUrl ?? null,
                            id: post.author.id,
                            username: post.author.handle,
                          },
                        ] as const
                    )),
              ]).values(),
            ]}
            count={
              (source === "bluesky" ? 0 : newPosts.length) +
              (source === "asm" ? 0 : external.newItems.length)
            }
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
            key={hashKey(communityQueryKey)}
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
        {hasAnyPosts ? (
          <FeedView
            key={`${hashKey(queryKey)}:${source}`}
            externalPosts={allowExternal ? externalPosts : []}
            source={source}
            cacheKey={queryKey}
            excludeIds={communityIds}
            excludePostId={excludePostId}
            posts={visibleGlobalPosts}
            respectInterests
            showEmpty={false}
            trending={isTrending}
            showCommunityReason={isTrending || isPersonalized}
            sortBy={isTrending || isPersonalized ? "server" : "newest"}
          />
        ) : null}
        {initialSourceLoading ? (
          <FeedViewSkeleton
            source={externalInitialLoading ? "bluesky" : source}
          />
        ) : null}
        {isFetchingNextPage && !initialSourceLoading ? (
          <LoadMoreSkeleton count={4} source={nextSkeletonSource} />
        ) : null}
        {hasNextPage && !isFetchingNextPage && !initialSourceLoading ? (
          <div className="flex justify-center p-4">
            <Button onClick={() => handleBottomReached(true)} variant="ghost">
              {external.isError ? "Retry loading posts" : "Load more posts"}
            </Button>
          </div>
        ) : null}
        {hasAnyPosts && feedComplete ? <FeedEnd /> : null}
      </InfiniteScrollContainer>
    </div>
  );
}
