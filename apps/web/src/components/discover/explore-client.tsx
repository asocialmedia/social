"use client";

import type { PostData, PostsPage, SearchCommunityResult } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import noFollowImage from "@assets/general/nofollow.png";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/shell/auth-prompt-card";
import CommunityAvatar from "@/components/communities/card/community-avatar";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import { CollapsibleTopBar } from "@/components/layouts/shell/collapsible-top-bar";
import PostHistoryCard from "@/components/posts/views/post-history-card";
import { useBlueskyFeed } from "@/components/protocols/use-bluesky-feed";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { useFeedExposures } from "@/hooks/feed/use-feed-exposures";
import { useFeedScrollMemory } from "@/hooks/feed/use-feed-scroll-memory";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import { useFeedTabSelection } from "@/hooks/feed/use-feed-tab-selection";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useSeamlessFeedHead } from "@/hooks/feed/use-seamless-feed-head";
import useDebounce from "@/hooks/use-debounce";
import { useDiscoverySuggestions } from "@/hooks/use-discovery-suggestions";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import kyInstance from "@/lib/ky";
import { canAutoContinueFeed } from "@/lib/posts/feed-pagination";
import {
  externalNetworkPostAllowed,
  externalNetworkPostRecommended,
  networkPostAllowed,
  networkPostRecommended,
} from "@/lib/posts/network-content-policy";
import { mixExplorePosts } from "@/lib/recommendations/mix-explore";
import {
  EXPLORE_TABS,
  isTabValue,
  resolveExploreTab,
  useTabMemoryReady,
  useTabStore,
} from "@/store/tab-store";
import type { ExploreTab } from "@/store/tab-store";

import { ExploreGuestSearch } from "./explore-guest-search";
import { ExploreGustsGrid } from "./explore-gusts-grid";
import { ExploreGustsRail } from "./explore-gusts-rail";
import { ExploreMasonry } from "./explore-masonry";
import ExploreMasonrySkeleton from "./explore-masonry-skeleton";
import {
  ExploreNetworkAccount,
  ExploreNetworkPost,
} from "./explore-network-cards";
import ExplorePostCard from "./explore-post-card";
import ExploreUserCard from "./explore-user-card";
import type { ExploreUser } from "./explore-user-card";

const TAB_META: Record<ExploreTab, string> = {
  "for-you": "For you",
  gusts: "Gusts",
  trending: "Trending",
};

// Swipe order must mirror the rendered strip order, which is this object's
// key order — derive it so the two can never drift apart.
const TAB_ORDER = Object.keys(TAB_META) as ExploreTab[];

interface FeedData {
  communities?: SearchCommunityResult[];
  posts: PostData[];
  nextCursor?: string | null;
  users: ExploreUser[];
}

const USER_INTERVAL = 6;

const ExploreClient: React.FC = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedHeadRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const hideTopBar = useHideOnScroll(feedScrollRef);
  const { user: sessionUser } = useSession();
  const isLoggedIn = Boolean(sessionUser);
  const network = useNetworkSettings();
  const suggestions = useDiscoverySuggestions();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const memoryReady = useTabMemoryReady();
  const storedExplore = useTabStore((state) => state.explore);
  const setExploreTab = useTabStore((state) => state.setExploreTab);

  const tabParam = searchParams.get("tab");
  // Explicit ?tab= wins (shareable links); otherwise the remembered tab
  // restores, so leaving for a profile and coming back lands where you left.
  // Guests default to the open Trending tab; For you is behind auth.
  const resolvedTab: ExploreTab = resolveExploreTab(
    tabParam,
    isLoggedIn,
    storedExplore,
    memoryReady
  );
  const [activeTab, selectTab] = useFeedTabSelection(resolvedTab);

  // Each tab keeps its own scroll position: leaving for a post and coming
  // back lands exactly where you left.
  useFeedScrollMemory({
    containerRef: feedScrollRef,
    memoryKey: `explore:${activeTab}`,
  });

  // "For you" needs an account (guests see the login card); Trending and Gusts stay open.
  const showForYou = isLoggedIn;

  const canQuery = isLoggedIn || activeTab !== "for-you";

  // Adopt shared links (?tab=...) into memory so they survive navigation too.
  useEffect(() => {
    if (isTabValue(EXPLORE_TABS, tabParam)) {
      setExploreTab(tabParam);
    }
  }, [setExploreTab, tabParam]);

  const handleTabChange = useCallback(
    (tab: string) => {
      if (!isTabValue(EXPLORE_TABS, tab)) {
        return;
      }
      const nextParams = new URLSearchParams(window.location.search);
      const currentTab = nextParams.get("tab");
      if (
        tab === (isTabValue(EXPLORE_TABS, currentTab) ? currentTab : activeTab)
      ) {
        return;
      }
      selectTab(tab);
      setExploreTab(tab);
      if (!isTabValue(EXPLORE_TABS, nextParams.get("tab"))) {
        nextParams.set("tab", activeTab);
        window.history.replaceState(null, "", `${pathname}?${nextParams}`);
      }
      nextParams.set("tab", tab);
      const query = nextParams.toString();
      window.history.pushState(
        null,
        "",
        query ? `${pathname}?${query}` : pathname
      );
    },
    [activeTab, pathname, selectTab, setExploreTab]
  );

  // Mobile swipes drag the tab strip like a carousel (same mechanism as the
  // home feed). The trending gusts rail keeps its own horizontal pan: the
  // hook ignores any gesture that starts inside the rail's overflow-x
  // scroller. No touch-pan-y is set on the scroll container here for the same
  // reason — an ancestor restricting touch-action can suppress the rail's own
  // native panning; the hook's preventDefault alone is sufficient.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = TAB_ORDER.indexOf(activeTab) + direction;
      if (nextIndex >= 0 && nextIndex < TAB_ORDER.length) {
        handleTabChange(TAB_ORDER[nextIndex]);
      }
    },
    [activeTab, handleTabChange]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate);

  // Fetch top Gusts for the trending rail (moderated gusts excluded)
  const { data: gustsData } = useQuery({
    enabled: network.ready && activeTab !== "gusts",
    queryFn: async ({ signal }) => {
      const res = await kyInstance
        .get("/api/gusts", {
          searchParams: {
            excludeModerated: "1",
            mode: "trending",
            network: "1",
            profile: network.settings.preferences.activeProfileId,
            take: "24",
          },
          signal,
        })
        .json<PostsPage>();
      return res.posts;
    },
    queryKey: ["explore-top-gusts", sessionUser?.id ?? "guest", network.scope],
    staleTime: 60 * 1000,
  });

  const remoteGusts = useBlueskyFeed(
    "trending",
    network.ready && activeTab !== "gusts" && !debouncedSearch.trim(),
    sessionUser?.id ?? "guest",
    "video",
    false,
    "explore"
  );
  const trendingRemoteGusts = useMemo(
    () =>
      (remoteGusts.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (post) =>
          externalNetworkPostRecommended(
            post,
            network.settings.preferences,
            undefined,
            network.settings.topicScope
          )
      ),
    [remoteGusts.data, network.settings]
  );

  const queryKey = useMemo(
    () => [
      "explore-feed",
      activeTab,
      debouncedSearch,
      sessionUser?.id ?? "guest",
      network.scope,
    ],
    [activeTab, debouncedSearch, sessionUser?.id, network.scope]
  );

  const { data, status, isFetching, hasNextPage, fetchNextPage } =
    useInfiniteQuery({
      enabled: canQuery && network.ready && activeTab !== "gusts",
      getNextPageParam: (page: FeedData) => page.nextCursor ?? undefined,
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam, signal }): Promise<FeedData> => {
        if (debouncedSearch.trim()) {
          const result = await kyInstance
            .get("/api/explore/search", {
              searchParams: {
                q: debouncedSearch.trim(),
                tab: activeTab,
                take: "20",
              },
              signal,
            })
            .json<FeedData>();
          return result satisfies FeedData;
        }

        const posts = await kyInstance
          .get(`/api/posts/${activeTab}`, {
            searchParams: {
              excludeModerated: "1",
              network: "1",
              profile: network.settings.preferences.activeProfileId,
              surface: "explore",
              ...(pageParam ? { cursor: pageParam } : {}),
            },
            signal,
          })
          .json<PostsPage>();
        return { nextCursor: posts.nextCursor, posts: posts.posts, users: [] };
      },
      queryKey,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    });

  const posts = useMemo(
    () => [
      ...new Map(
        data?.pages.flatMap((page) => page.posts).map((post) => [post.id, post])
      ).values(),
    ],
    [data]
  );
  const users = useMemo(() => data?.pages[0]?.users ?? [], [data]);
  const communities = useMemo(() => data?.pages[0]?.communities ?? [], [data]);
  const gusts = useMemo(() => gustsData ?? [], [gustsData]);

  const remote = useBlueskyFeed(
    activeTab === "trending" ? "trending" : "personalized",
    canQuery && activeTab !== "gusts" && !debouncedSearch.trim(),
    sessionUser?.id ?? "guest",
    "all",
    false,
    "explore"
  );
  const remoteSearch = useQuery({
    enabled:
      network.ready &&
      canQuery &&
      activeTab !== "gusts" &&
      debouncedSearch.trim().length >= 2,
    queryFn: ({ signal }) =>
      kyInstance
        .get("/api/protocols/bluesky/search", {
          searchParams: { kind: "post", q: debouncedSearch.trim() },
          signal,
        })
        .json<{ posts: ExternalPost[] }>(),
    queryKey: [
      "explore-network-search",
      debouncedSearch.trim(),
      sessionUser?.id ?? "guest",
      network.scope,
    ],
    retry: false,
    staleTime: 30_000,
  });
  const remotePosts = useMemo(
    () =>
      (debouncedSearch.trim()
        ? (remoteSearch.data?.posts ?? [])
        : (remote.data?.pages.flatMap((page) => page.items) ?? [])
      ).filter((post) =>
        debouncedSearch.trim()
          ? externalNetworkPostAllowed(
              post,
              network.settings.preferences,
              network.settings.topicScope
            )
          : externalNetworkPostRecommended(
              post,
              network.settings.preferences,
              undefined,
              network.settings.topicScope
            )
      ),
    [debouncedSearch, remoteSearch.data, remote.data, network.settings]
  );
  const homeSeen = useFeedExposures(
    sessionUser?.id ?? "guest",
    "explore",
    activeTab === "trending" ? "trending" : "personalized"
  );
  const mixed = useMemo(
    () =>
      mixExplorePosts(
        posts.filter(
          (post) =>
            !homeSeen.has(post.id) &&
            networkPostAllowed(
              post,
              network.settings.preferences,
              network.settings.topicScope
            ) &&
            (debouncedSearch.trim() ||
              networkPostRecommended(
                post,
                network.settings.preferences,
                network.settings.topicScope
              ))
        ),
        remotePosts.filter((post) => !homeSeen.has(post.id))
      ),
    [posts, remotePosts, homeSeen, debouncedSearch, network.settings]
  );

  const handleFollowed = useCallback(
    (userId: string) => {
      void userId;
      void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient, queryKey]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleClearSearch = useCallback(() => {
    setSearch("");
  }, []);

  // Interleave user cards into the post stream (Pinterest-style).
  const items = useMemo(() => {
    const result: React.ReactElement[] = [];
    let postIndex = 0;
    let userIndex = 0;

    for (let slot = 0; postIndex < mixed.length; slot += 1) {
      if (
        userIndex < users.length &&
        slot % USER_INTERVAL === USER_INTERVAL - 1
      ) {
        const user = users[userIndex];
        result.push(
          <ExploreUserCard
            className="mb-4"
            key={`user-${user.id}`}
            onFollowed={handleFollowed}
            user={user}
          />
        );
        userIndex += 1;
      } else {
        const entry = mixed[postIndex];
        result.push(
          entry.source === "asm" ? (
            <RecommendationTracker
              exposureFeed={
                activeTab === "trending" ? "trending" : "personalized"
              }
              key={`post-${entry.post.id}`}
              postId={entry.post.id}
              networkSource="asm"
              networkToken={entry.post.networkRecommendationToken}
            >
              <ExplorePostCard post={entry.post} />
            </RecommendationTracker>
          ) : (
            <ExploreNetworkPost
              exposureFeed={
                activeTab === "trending" ? "trending" : "personalized"
              }
              key={`network-${entry.post.id}`}
              post={entry.post}
            />
          )
        );
        if (
          !debouncedSearch.trim() &&
          postIndex % USER_INTERVAL === USER_INTERVAL - 1
        ) {
          const account =
            suggestions.data?.accounts[Math.floor(postIndex / USER_INTERVAL)];
          if (account) {
            result.push(
              <ExploreNetworkAccount
                key={`account-${account.source}-${account.id}`}
                account={account}
              />
            );
          }
        }
        postIndex += 1;
      }
    }

    while (userIndex < users.length) {
      const user = users[userIndex];
      result.push(
        <ExploreUserCard
          className="mb-4"
          key={`user-${user.id}`}
          onFollowed={handleFollowed}
          user={user}
        />
      );
      userIndex += 1;
    }

    return result;
  }, [
    handleFollowed,
    mixed,
    users,
    debouncedSearch,
    suggestions.data,
    activeTab,
  ]);

  const hasGustRail =
    !debouncedSearch.trim() &&
    (gusts.length > 0 || trendingRemoteGusts.length > 0);
  let body: React.ReactNode;
  if (!network.ready && network.isError) {
    body = (
      <FeedErrorState
        message="We couldn’t load your feed preferences. Please try again."
        onRetry={() => {
          void network.refetch();
        }}
        isRetrying={network.isFetching}
      />
    );
  } else if (
    (status === "pending" ||
      (!debouncedSearch.trim() && remote.isPending) ||
      (debouncedSearch.trim().length >= 2 && remoteSearch.isPending)) &&
    !mixed.length &&
    !hasGustRail
  ) {
    body = <ExploreMasonrySkeleton />;
  } else if (
    (status === "error" ||
      (!debouncedSearch.trim() && remote.isError) ||
      (debouncedSearch.trim().length >= 2 && remoteSearch.isError)) &&
    !mixed.length &&
    !hasGustRail
  ) {
    body = (
      <FeedErrorState
        message="We couldn’t load recommendations right now. Please try again in a moment."
        onRetry={() => {
          void queryClient.refetchQueries({ queryKey });
          void remote.refetch();
          if (debouncedSearch.trim()) {
            void remoteSearch.refetch();
          }
        }}
      />
    );
  } else if (items.length === 0 && !hasGustRail) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noFollowImage}
          width={1536}
        />
        <p className="font-medium">
          {debouncedSearch.trim()
            ? `No results for "${debouncedSearch.trim()}"`
            : "Nothing here yet"}
        </p>
        <p className="text-muted-foreground text-sm">
          {debouncedSearch.trim()
            ? "Try a different name or topic"
            : "Follow people to see their fleets here."}
        </p>
      </div>
    );
  } else {
    body = (
      <AnimatePresence mode="wait">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="p-4"
          exit={{ opacity: 0, y: -8 }}
          initial={{ opacity: 0, y: 8 }}
          key={debouncedSearch.trim() || "feed"}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {/* Top Gusts rail on explore feed */}
          {hasGustRail ? (
            <ExploreGustsRail
              gusts={gusts}
              external={trendingRemoteGusts}
              onViewAll={() => handleTabChange("gusts")}
            />
          ) : null}

          {/* Community matches, above the post masonry, when searching. */}
          {debouncedSearch.trim() && communities.length > 0 ? (
            <section className="mb-5">
              <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                Communities
              </h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {communities.map((community) => (
                  <Link
                    className="border-border/60 hover:bg-muted/50 flex w-56 shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors"
                    href={`/a/${community.slug}`}
                    key={community.id}
                  >
                    <CommunityAvatar
                      accentColor={community.accentColor}
                      avatarUrl={community.avatarUrl}
                      className="size-9"
                      name={community.name}
                      slug={community.slug}
                    />
                    <span className="min-w-0">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {community.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        a/{community.slug}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* Masonry Post Stream */}
          {hasGustRail ? (
            <h2 className="text-foreground mb-4 text-base font-semibold">
              More to explore
            </h2>
          ) : null}
          <ExploreMasonry scope={JSON.stringify(queryKey)}>
            {items}
          </ExploreMasonry>
        </motion.div>
      </AnimatePresence>
    );
  }

  const loadMore = (manual = false) => {
    if (
      hasNextPage &&
      !isFetching &&
      (manual || status !== "error") &&
      (manual || canAutoContinueFeed(data?.pages, (page) => page.posts))
    ) {
      void fetchNextPage({ cancelRefetch: false });
    }
    if (
      remote.hasNextPage &&
      !remote.isFetching &&
      (manual || !remote.isError) &&
      (manual || canAutoContinueFeed(remote.data?.pages, (page) => page.items))
    ) {
      void remote.fetchNextPage({ cancelRefetch: false });
    }
  };
  const feedContinuation = (
    <div>
      {!debouncedSearch.trim() && (isFetching || remote.isFetching) ? (
        <ExploreMasonrySkeleton compact />
      ) : null}
      {remote.isError || status === "error" ? (
        <FeedErrorState
          compact
          message="Some recommendations couldn’t load. Please try again in a moment."
          isRetrying={isFetching || remote.isFetching}
          onRetry={() => {
            if (remote.isError) {
              if (remote.hasNextPage) {
                void remote.fetchNextPage({ cancelRefetch: false });
              } else {
                void remote.refetch();
              }
            }
            if (status === "error") {
              void queryClient.refetchQueries({ queryKey });
            }
          }}
        />
      ) : null}
      {(hasNextPage || remote.hasNextPage) &&
      !isFetching &&
      !remote.isFetching &&
      !remote.isError &&
      status !== "error" ? (
        <div className="flex justify-center p-4">
          <Button variant="premium" onClick={() => loadMore(true)}>
            Load more posts
          </Button>
        </div>
      ) : null}
    </div>
  );

  const searchField = (
    <div className="relative">
      <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        aria-label="Search explore"
        autoComplete="off"
        className="h-10 pr-9 pl-9"
        onChange={handleSearchChange}
        placeholder="Search explore"
        type="text"
        value={search}
      />
      {search ? (
        <button
          aria-label="Clear search"
          className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1"
          onClick={handleClearSearch}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
  useSeamlessFeedHead({
    count: remote.newItems.length,
    enabled:
      !debouncedSearch.trim() && activeTab !== "gusts" && Boolean(remote.data),
    merge: remote.showNewItems,
    probe: remote.probeNow,
    root: feedHeadRef,
  });
  const stream = (
    <div ref={feedHeadRef}>
      <InfiniteScrollContainer
        onBottomReached={loadMore}
        prefetchDistance={1500}
      >
        {body}
        {feedContinuation}
      </InfiniteScrollContainer>
    </div>
  );
  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          value={activeTab}
          onValueChange={handleTabChange}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 backdrop-blur-md">
            <CollapsibleTopBar hidden={hideTopBar}>
              <MobileTopBar />
            </CollapsibleTopBar>
            <div className="border-border/60 flex items-center gap-4 border-b px-3 py-1.5">
              <TabsList className="flex h-full min-w-0 flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
                {TAB_ORDER.map((tab) => (
                  <AnimatedTabTrigger
                    active={activeTab === tab}
                    key={tab}
                    layoutId="explore-tab-indicator"
                    value={tab}
                  >
                    {TAB_META[tab]}
                  </AnimatedTabTrigger>
                ))}
              </TabsList>
              {isLoggedIn && activeTab !== "gusts" ? (
                <div className="hidden w-60 shrink-0 md:block xl:hidden">
                  {searchField}
                </div>
              ) : null}
            </div>
            {isLoggedIn ? null : <ExploreGuestSearch />}
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full overflow-y-auto overscroll-contain"
              ref={feedScrollRef}
            >
              <TabsContent className="mt-0" value="for-you">
                {showForYou ? (
                  stream
                ) : (
                  <div className="px-4 py-10">
                    <AuthPromptCard
                      className="mx-auto w-full max-w-md"
                      description="Sign in to see fleets curated just for you."
                      imageSize={128}
                      title="Log in to see your feed"
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent className="mt-0" value="trending">
                {stream}
              </TabsContent>
              <TabsContent className="mt-0" value="gusts">
                <ExploreGustsGrid />
              </TabsContent>
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>
      <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-visible border-l px-2.5 pt-2.5 pb-6 xl:flex">
        {isLoggedIn && activeTab !== "gusts" ? (
          <div className="shrink-0 pb-4">{searchField}</div>
        ) : null}
        <div className="hide-native-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto">
          {isLoggedIn ? <PostHistoryCard /> : null}
          <TrendingTopics />
        </div>
      </aside>
      <MobileBottomNav />
    </>
  );
};

export default ExploreClient;
