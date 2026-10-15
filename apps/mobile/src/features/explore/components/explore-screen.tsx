import { FlashList } from "@shopify/flash-list";
import type { FlashListRef } from "@shopify/flash-list";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronRight,
  Clapperboard,
  Eye,
  Flame,
  Plus,
} from "lucide-react-native";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Ref } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ScrollViewProps } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import {
  createAnimatedComponent,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import noFollowImage from "@/assets/images/nofollow.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedPager } from "@/features/feed/components/feed-pager";
import { NewContentPill } from "@/features/feed/components/new-content-pill";
import type { PillAuthor } from "@/features/feed/components/new-content-pill";
import { findUnseenItems } from "@/features/feed/lib/feed-types";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { mediaGridImageUrl } from "@/features/feed/lib/media-url";
import {
  EXPLORE_TABS,
  resolveExploreTab,
  resolveExploreDiscoveryTab,
} from "@/features/feed/state/tab-store";
import type { ExploreTab } from "@/features/feed/state/tab-store";
import {
  useHomeTabMemoryReady,
  useTabStore,
} from "@/features/feed/state/tab-store-native";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { createExpoPoller } from "@/lib/expo-poller";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { logInfo, logWarn } from "@/lib/telemetry";
import {
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import {
  ExploreApiError,
  fetchExploreHeadPosts,
  fetchExplorePage,
  fetchExplorePeople,
  fetchExploreTopGusts,
  mutateExploreFollow,
} from "../lib/explore-api";
import type { ExploreUser } from "../lib/explore-api";
import { exploreCache, exploreCacheKey } from "../lib/explore-cache";
import type { ExploreData } from "../lib/explore-cache";
import { hydrateExploreCache } from "../lib/explore-cache-native";
import { exploreFeedTabs, explorePageIndex } from "../lib/explore-navigation";
import { ExploreBadge } from "./explore-badge";
import { ExploreFeedControls } from "./explore-feed-controls";
import { ExploreGuestSearch } from "./explore-guest-search";
import { ExplorePostCard } from "./explore-post-card";
import { ExploreLoadingSkeleton } from "./explore-skeleton";
import { ExploreUserCard } from "./explore-user-card";

// Matches web's useNewContentProbe cadence on the Explore feeds.
const PROBE_INTERVAL_MS = 45_000;

type ExploreItem =
  | { kind: "post"; post: FeedPost }
  | { kind: "user"; user: ExploreUser };

const AnimatedExploreList = createAnimatedComponent(FlashList<ExploreItem>);
const MAINTAIN_POSITION = { disabled: true };

function itemType(item: ExploreItem): ExploreItem["kind"] {
  return item.kind;
}

function itemKey(item: ExploreItem): string {
  return `${item.kind}-${item.kind === "post" ? item.post.id : item.user.id}`;
}

export function ExploreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const { isPending, user } = useSessionContext();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [dockHeight, setDockHeight] = useState(56);
  const { theme } = useAppTheme();
  const mobileHeaderUser = user
    ? { ...user, username: user.username ?? "unknown" }
    : null;
  const showGuestBar = !isPending && !user;
  const memoryReady = useHomeTabMemoryReady();
  const storedExplore = useTabStore((state) => state.explore);
  const storedDiscovery = useTabStore((state) => state.exploreDiscovery);
  const setExploreTab = useTabStore((state) => state.setExploreTab);
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const activeTab = resolveExploreTab(
    tabParam ?? null,
    Boolean(user),
    storedExplore,
    memoryReady
  );
  const discovery = resolveExploreDiscoveryTab(
    activeTab,
    Boolean(user),
    storedDiscovery,
    memoryReady
  );
  const tabs = useMemo(() => exploreFeedTabs(discovery), [discovery]);
  useEffect(() => {
    if (
      memoryReady &&
      (activeTab === "for-you" || activeTab === "trending") &&
      storedDiscovery?.value !== activeTab
    ) {
      setExploreTab(activeTab);
    }
  }, [activeTab, memoryReady, setExploreTab, storedDiscovery?.value]);
  const selectTab = useCallback(
    (next: ExploreTab) => {
      if (!EXPLORE_TABS.has(next)) {
        return;
      }
      setExploreTab(next);
      router.setParams({ tab: next });
    },
    [router, setExploreTab]
  );
  const activeIndex = explorePageIndex(activeTab);
  const changeIndex = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (tab) {
        selectTab(tab.value);
      }
    },
    [selectTab, tabs]
  );
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader user={mobileHeaderUser} />
      <ExploreFeedControls
        active={activeTab}
        discovery={discovery}
        onChange={selectTab}
      />
      {showGuestBar ? <ExploreGuestSearch /> : null}
      {memoryReady ? (
        <FeedPager
          activeIndex={activeIndex}
          onIndexChange={changeIndex}
          publishOnSettle
        >
          {tabs.map((tab, index) =>
            index === 0 ? (
              <View
                key={`discovery:${user?.id ?? "guest"}`}
                style={styles.root}
              >
                {(["for-you", "trending"] as const).map((feed) => (
                  <View
                    key={feed}
                    pointerEvents={feed === discovery ? "auto" : "none"}
                    accessibilityElementsHidden={feed !== discovery}
                    importantForAccessibility={
                      feed === discovery ? "auto" : "no-hide-descendants"
                    }
                    style={[
                      StyleSheet.absoluteFill,
                      { opacity: feed === discovery ? 1 : 0 },
                    ]}
                  >
                    <ExploreDiscoveryContent
                      activeTab={feed}
                      selected={feed === discovery}
                      isActive={
                        isFocused && activeIndex === 0 && feed === discovery
                      }
                      enabled={
                        isFocused &&
                        feed === discovery &&
                        Math.abs(activeIndex) <= 1
                      }
                      selectTab={selectTab}
                      bottomInset={showGuestBar ? 176 : 96}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <ExploreTabContent
                key={`${tab.value}:${user?.id ?? "guest"}`}
                activeTab={tab.value}
                isActive={isFocused && index === activeIndex}
                enabled={isFocused && Math.abs(index - activeIndex) <= 1}
                selectTab={selectTab}
                bottomInset={showGuestBar ? 176 : 96}
              />
            )
          )}
        </FeedPager>
      ) : (
        <ActivityIndicator color="#f97316" style={styles.root} />
      )}
      {showGuestBar ? (
        <View
          pointerEvents="box-none"
          style={[styles.authDock, { bottom: dockHeight + insets.bottom + 12 }]}
        >
          <GuestAuthBar />
        </View>
      ) : null}
      <MobileBottomNav onHeightChange={setDockHeight} />
    </View>
  );
}

const EMPTY_DATA: ExploreData = {
  communities: [],
  gusts: [],
  nextCursor: null,
  posts: [],
  users: [],
};

// Do not construct the other discovery feed until it has actually been selected.
// Once visited, keep its recycler and position for an instant return.
function ExploreDiscoveryContent({
  selected,
  ...props
}: Parameters<typeof ExploreTabContent>[0] & { selected: boolean }) {
  const [visited, setVisited] = useState(selected);
  if (selected && !visited) {
    setVisited(true);
  }
  return visited || selected ? <ExploreTabContent {...props} /> : null;
}

const ExploreTabContent = memo(
  ({
    activeTab,
    isActive,
    enabled,
    selectTab,
    bottomInset,
  }: {
    activeTab: ExploreTab;
    isActive: boolean;
    enabled: boolean;
    selectTab: (tab: ExploreTab) => void;
    bottomInset: number;
  }) => {
    const router = useRouter();
    const { isPending, user } = useSessionContext();
    const viewerId = user?.id;
    const { runWithInstallToken } = useInstall();
    const { theme } = useAppTheme();
    const deferredSearch = "";
    const apiBase = getApiBaseUrl();
    const cacheKey = exploreCacheKey(
      apiBase,
      viewerId,
      activeTab,
      deferredSearch
    );
    const resource = useSyncExternalStore(exploreCache.subscribe, () =>
      exploreCache.read(cacheKey)
    );
    const { posts, users, gusts, nextCursor } = resource.data ?? EMPTY_DATA;
    let status: "error" | "loading" | "success" = "loading";
    if (resource.data) {
      status = "success";
    } else if (resource.error) {
      status = "error";
    }
    const refreshing = resource.pending === "refresh";
    const loadingMore = resource.pending === "append";
    const [newItems, setNewItems] = useState<FeedPost[]>([]);
    const scrollViewRef = useRef<FlashListRef<ExploreItem>>(null);
    const [isScrolledDown, setIsScrolledDown] = useState(false);
    const restoredKey = useRef<string | null>(null);
    const initialOffset = useMemo(
      () => exploreCache.scrollOffset(cacheKey),
      [cacheKey]
    );

    const load = useCallback(
      async (cursor: string | null, append: boolean, refresh = false) => {
        if (!viewerId && activeTab === "for-you") {
          return;
        }
        const replacementMode = refresh ? "refresh" : "initial";
        if (!append && !refresh && exploreCache.isFresh(cacheKey)) {
          logInfo("explore.cache_hit", { tab: activeTab });
        }
        await exploreCache.load(
          cacheKey,
          async () => {
            logInfo("explore.page_request", {
              append,
              refresh,
              searching: Boolean(deferredSearch),
              tab: activeTab,
            });
            const options = { apiBase, cookie: await authClient.getCookie() };
            const [page, topGusts] = await Promise.all([
              activeTab === "people"
                ? fetchExplorePeople(
                    deferredSearch,
                    Boolean(viewerId),
                    options,
                    refresh
                  )
                : fetchExplorePage(activeTab, deferredSearch, cursor, options),
              !append && (activeTab === "for-you" || activeTab === "trending")
                ? fetchExploreTopGusts(options)
                : Promise.resolve([]),
            ]);
            return { ...page, gusts: topGusts };
          },
          append ? "append" : replacementMode,
          cursor ?? undefined
        );
      },
      [activeTab, apiBase, cacheKey, deferredSearch, viewerId]
    );

    useEffect(() => {
      if ((!enabled && !isActive) || (isPending && !viewerId)) {
        return;
      }
      let cancelled = false;
      void (async () => {
        await hydrateExploreCache();
        if (!cancelled) {
          void load(null, false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [enabled, isActive, isPending, load, viewerId]);

    const handleFollow = useCallback(
      async (userId: string, next: boolean) => {
        if (!viewerId) {
          router.push("/(auth)/login");
          throw new Error("Sign in to follow people");
        }
        const cookie = await authClient.getCookie();
        const result = await runWithInstallToken(
          () =>
            mutateExploreFollow(userId, next, {
              apiBase: getApiBaseUrl(),
              cookie,
            }),
          (value) => value instanceof ExploreApiError && value.status === 403
        );
        if (!result) {
          throw new Error("Follow request cancelled");
        }
        exploreCache.updateFollow(apiBase, viewerId, userId, result);
      },
      [apiBase, router, runWithInstallToken, viewerId]
    );

    // Web polls each Explore feed every 45s and offers the new posts behind a
    // pill, so a reader who has sat on the tab sees arrivals without pulling to
    // refresh. The probe diffs the head against what is already on screen and
    // never rewrites the list on its own; tapping the pill prepends and scrolls to top.
    const knownIdsRef = useRef<Set<string>>(new Set());
    const newestIdRef = useRef<string | null>(null);
    const probeKeyRef = useRef("");
    const probeTab = activeTab;
    const probeSearch = deferredSearch;

    useEffect(() => {
      newestIdRef.current = posts.length > 0 ? posts[0].id : null;
      knownIdsRef.current = new Set(posts.map((post) => post.id));
    }, [posts]);

    useEffect(() => {
      if (
        !isActive ||
        (!viewerId && probeTab === "for-you") ||
        status !== "success" ||
        probeTab === "gusts" ||
        probeTab === "people" ||
        probeSearch
      ) {
        return;
      }
      let cancelled = false;
      const key = cacheKey;
      probeKeyRef.current = key;
      const probe = async () => {
        try {
          const headPosts = await fetchExploreHeadPosts(
            probeTab as "for-you" | "trending",
            {
              apiBase: getApiBaseUrl(),
              cookie: await authClient.getCookie(),
            }
          );
          if (
            cancelled ||
            probeKeyRef.current !== key ||
            knownIdsRef.current.size === 0
          ) {
            return;
          }
          const newest = headPosts[0]?.id;
          // If the newest post is unchanged, the head is unchanged - do not count
          // shifts or re-rankings inside candidate sets as new arrivals.
          if (!newest || newest === newestIdRef.current) {
            return;
          }
          newestIdRef.current = newest;
          const unseen = findUnseenItems(headPosts, knownIdsRef.current);
          if (unseen.length > 0) {
            setNewItems(unseen);
          }
        } catch (error) {
          logWarn("explore.probe_failed", {
            reason: error instanceof Error ? error.message : String(error),
            tab: probeTab,
          });
        }
      };
      const poller = createExpoPoller({
        intervalMs: PROBE_INTERVAL_MS,
        onPoll: probe,
        skipInitialPoll: true,
      });
      poller.start();
      return () => {
        cancelled = true;
        poller.stop();
      };
    }, [cacheKey, isActive, probeTab, probeSearch, status, viewerId]);

    const showNewItems = useCallback(() => {
      if (newItems.length === 0) {
        return;
      }
      logInfo("explore.new_shown", { count: newItems.length, tab: activeTab });
      exploreCache.prepend(cacheKey, newItems);
      setNewItems([]);
      scrollViewRef.current?.scrollToOffset({ animated: true, offset: 0 });
    }, [activeTab, cacheKey, newItems]);

    const newItemAuthors: PillAuthor[] = [
      ...new Map(
        newItems.map((post) => [
          post.userId,
          {
            avatarUrl: post.user?.avatarUrl,
            id: post.userId,
            username: post.user?.username,
          },
        ])
      ).values(),
    ];

    const refresh = useCallback(() => {
      void load(null, false, true);
    }, [load]);

    const handleCreateGust = () => {
      router.push(
        viewerId
          ? { params: { create: "true" }, pathname: "/gusts" }
          : "/(auth)/login"
      );
    };

    const fetchMore = useCallback(() => {
      if (
        !isActive ||
        resource.pending ||
        resource.error ||
        !nextCursor ||
        activeTab === "people"
      ) {
        return;
      }
      void load(nextCursor, true);
    }, [
      activeTab,
      isActive,
      load,
      nextCursor,
      resource.error,
      resource.pending,
    ]);

    const items = useMemo<ExploreItem[]>(() => {
      const next: ExploreItem[] = [];
      let userIndex = 0;
      for (let index = 0; index < posts.length; index += 1) {
        if (
          activeTab !== "people" &&
          userIndex < users.length &&
          index > 0 &&
          index % 6 === 0
        ) {
          const candidate = users[userIndex];
          if (candidate) {
            next.push({ kind: "user", user: candidate });
            userIndex += 1;
          }
        }
        const post = posts[index];
        if (post) {
          next.push({ kind: "post", post });
        }
      }
      while (userIndex < users.length) {
        const candidate = users[userIndex];
        if (candidate) {
          next.push({ kind: "user", user: candidate });
        }
        userIndex += 1;
      }
      return next;
    }, [activeTab, posts, users]);

    // The same 3D pull loader the feed uses, not the stock RefreshControl, so a
    // refresh here reads identically to a refresh there. Placed before the
    // loading early-return below, since a hook after one is conditional.
    const pull = usePullToRefresh({
      failed: Boolean(resource.error),
      onRefresh: refresh,
      refreshing,
      updatedMessage: "Explore updated",
    });

    const { nativeScrollGesture } = pull;
    const renderScrollComponent = useCallback(
      (props: ScrollViewProps & { ref?: Ref<ScrollView> }) => (
        <GestureDetector gesture={nativeScrollGesture}>
          <ScrollView {...props} />
        </GestureDetector>
      ),
      [nativeScrollGesture]
    );

    const scrollOffset = useSharedValue(initialOffset);
    const scrolledDown = useSharedValue(initialOffset > 180);
    const reportPullOffset = pull.onScrollOffset;
    const endPull = pull.onScrollEndDrag;
    const saveOffset = useCallback(
      (offset: number) => {
        exploreCache.setScrollOffset(cacheKey, offset);
      },
      [cacheKey]
    );
    // Only edge crossings and the end of a drag/fling need the RN thread.
    const handleContentScroll = useAnimatedScrollHandler({
      onEndDrag: (event) => {
        scheduleOnRN(saveOffset, event.contentOffset.y);
        scheduleOnRN(endPull);
      },
      onMomentumEnd: (event) => {
        scheduleOnRN(saveOffset, event.contentOffset.y);
      },
      onScroll: (event) => {
        const offset = event.contentOffset.y;
        const previous = scrollOffset.get();
        scrollOffset.set(offset);
        const scrolled = offset > 180;
        if (scrolled !== scrolledDown.get()) {
          scrolledDown.set(scrolled);
          scheduleOnRN(setIsScrolledDown, scrolled);
        }
        if (offset <= 0 || previous <= 0) {
          scheduleOnRN(reportPullOffset, offset);
        }
      },
    });

    const renderItem = useCallback(
      ({ item, index }: { index: number; item: ExploreItem }) => {
        if (activeTab === "gusts") {
          if (item.kind !== "post") {
            return null;
          }
          return (
            <ExploreGustTile
              isGrid
              onPress={() =>
                // Web opens the reel positioned at this gust rather than the
                // post page, so the tap lands on the video it came from.
                router.push({
                  params: { id: item.post.id },
                  pathname: "/gusts",
                })
              }
              post={item.post}
            />
          );
        }
        if (item.kind === "post") {
          return (
            <ExplorePostCard
              onPress={() =>
                router.push({
                  params: { postId: item.post.id },
                  pathname: "/posts/[postId]",
                })
              }
              onRequireLogin={() => router.push("/(auth)/login")}
              post={item.post}
              viewerId={viewerId ?? null}
            />
          );
        }
        return (
          <ExploreUserCard
            canFollow={viewerId !== item.user.id}
            highlight={
              Boolean(viewerId) &&
              activeTab === "people" &&
              !deferredSearch &&
              index < 5
            }
            onFollow={(next) => handleFollow(item.user.id, next)}
            onPress={() =>
              router.push({
                params: { username: item.user.username },
                pathname: "/users/[username]",
              })
            }
            reason={item.user.reason ?? item.user.reasons?.[0]}
            user={item.user}
          />
        );
      },
      [activeTab, deferredSearch, handleFollow, router, viewerId]
    );

    const showPill =
      newItems.length > 0 &&
      activeTab !== "gusts" &&
      activeTab !== "people" &&
      !deferredSearch;

    const header = (
      <View style={{ marginHorizontal: activeTab === "people" ? -16 : -8 }}>
        {showPill && !isScrolledDown ? (
          <View style={styles.pillRow}>
            <NewContentPill
              authors={newItemAuthors}
              count={newItems.length}
              floating={false}
              onPress={showNewItems}
            />
          </View>
        ) : null}
        {activeTab === "people" ? (
          <ExplorePeopleHeader
            loggedIn={Boolean(viewerId)}
            onRefresh={refresh}
          />
        ) : null}
        {gusts.length > 0 && activeTab !== "gusts" && activeTab !== "people" ? (
          <View style={styles.gustRail} testID="explore-gusts-rail">
            <View style={styles.railHeading}>
              <View style={styles.railTitleGroup}>
                <View style={styles.railTitleRow}>
                  <Clapperboard color="#f97316" size={16} />
                  <Text
                    style={[styles.sectionTitle, { color: theme.inputText }]}
                  >
                    Trending Gusts
                  </Text>
                </View>
                <Text
                  style={[styles.railSubtitle, { color: theme.dividerText }]}
                >
                  Short-form clips taking off right now
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => selectTab("gusts")}
              >
                <View style={styles.seeAllRow}>
                  <Text style={[styles.seeAll, { color: "#f97316" }]}>
                    See all
                  </Text>
                  <ChevronRight color="#f97316" size={14} />
                </View>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.gustRow}
              horizontal
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
            >
              {gusts.map((post) => (
                <ExploreGustTile
                  key={post.id}
                  onPress={() =>
                    router.push({ params: { id: post.id }, pathname: "/gusts" })
                  }
                  post={post}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    );

    let empty: React.ReactNode = null;
    if (activeTab === "for-you" && !viewerId && !isPending) {
      empty = (
        <ExploreAuthPrompt onLogin={() => router.push("/(auth)/login")} />
      );
    } else if (status === "loading") {
      empty = <ExploreLoadingSkeleton tab={activeTab} />;
    } else if (status === "error") {
      const message = errorMessageFor(activeTab);
      empty = (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: theme.errorBannerText }]}>
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={refresh}
            style={styles.refreshButton}
          >
            <Text style={styles.refreshText}>Retry</Text>
          </Pressable>
        </View>
      );
    } else if (items.length === 0) {
      empty = (
        <ExploreEmptyState
          activeTab={activeTab}
          onCreate={handleCreateGust}
          search={deferredSearch}
        />
      );
    }

    let footer: React.ReactNode = null;
    if (resource.error && resource.data) {
      footer = (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: theme.errorBannerText }]}>
            Could not update Explore. Your saved items are still available.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={refresh}
            style={styles.refreshButton}
          >
            <Text style={styles.refreshText}>Retry</Text>
          </Pressable>
        </View>
      );
    } else if (loadingMore) {
      footer = <ExploreLoadingSkeleton continuation tab={activeTab} />;
    }

    return (
      <GestureDetector gesture={pull.gesture}>
        <View style={styles.listWrap}>
          <Animated.View
            style={[
              styles.listShift,
              { transform: [{ translateY: pull.pullShift }] },
            ]}
          >
            <AnimatedExploreList
              key={cacheKey}
              ref={scrollViewRef}
              renderScrollComponent={renderScrollComponent}
              data={empty ? [] : items}
              masonry={activeTab !== "people"}
              numColumns={activeTab === "people" ? 1 : 2}
              optimizeItemArrangement={false}
              getItemType={itemType}
              keyExtractor={itemKey}
              contentContainerStyle={{
                paddingBottom: bottomInset,
                paddingHorizontal: activeTab === "people" ? 16 : 8,
                paddingTop: activeTab === "gusts" ? 16 : 0,
              }}
              keyboardShouldPersistTaps="handled"
              maintainVisibleContentPosition={MAINTAIN_POSITION}
              onLoad={() => {
                if (restoredKey.current === cacheKey) {
                  return;
                }
                restoredKey.current = cacheKey;
                const offset = initialOffset;
                if (offset > 0) {
                  scrollViewRef.current?.scrollToOffset({
                    animated: false,
                    offset,
                  });
                }
              }}
              onEndReached={fetchMore}
              onEndReachedThreshold={0.5}
              onScroll={handleContentScroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              ListFooterComponent={footer}
              renderItem={({ item, index }) => (
                <View
                  style={activeTab === "people" ? undefined : styles.gridCell}
                >
                  {renderItem({ index, item })}
                </View>
              )}
            />
          </Animated.View>
          {pull.loader}
          {showPill && isScrolledDown ? (
            <View
              pointerEvents="box-none"
              style={[styles.floatingPillWrap, { top: 8 }]}
            >
              <NewContentPill
                authors={newItemAuthors}
                count={newItems.length}
                floating={false}
                onPress={showNewItems}
              />
            </View>
          ) : null}
        </View>
      </GestureDetector>
    );
  }
);

ExploreTabContent.displayName = "ExploreTabContent";

function ExploreGustTile({
  isGrid,
  onPress,
  post,
}: {
  isGrid?: boolean;
  onPress: () => void;
  post: FeedPost;
}) {
  const { isDark, theme } = useAppTheme();
  const media = post.attachments?.find(
    (attachment) => attachment.type === "VIDEO"
  );
  if (!media) {
    return null;
  }
  const imageUrl = mediaGridImageUrl(getApiBaseUrl(), media);
  return (
    <Pressable
      accessibilityLabel={`Open Gust by ${post.user?.displayName ?? post.user?.username ?? "user"}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.gustTile,
        isGrid && styles.gustTileGrid,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <Image
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: imageUrl }}
        style={styles.gustImage}
      />
      <ExploreBadge kind="gust" style={styles.gustBadge} />
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.92)"]}
        style={styles.gustOverlay}
      >
        <View style={styles.gustAuthorRow}>
          <UserAvatar size={24} url={post.user?.avatarUrl} />
          <View style={styles.gustAuthorCopy}>
            <View style={styles.gustAuthorNameRow}>
              <Text numberOfLines={1} style={styles.gustAuthorName}>
                {post.user?.displayName ?? post.user?.username ?? "Anonymous"}
              </Text>
              <UserBadge
                badge={post.user?.badge}
                badges={post.user?.badges}
                communityRoles={post.user?.communityMemberships}
              />
            </View>
            <Text numberOfLines={1} style={styles.gustUsername}>
              @{post.user?.username ?? "unknown"}
            </Text>
          </View>
        </View>
        {post.content ? (
          <Text numberOfLines={1} style={styles.gustContent}>
            {post.content}
          </Text>
        ) : null}
        <View style={styles.gustMetrics}>
          <View style={styles.gustMetric}>
            <Eye color="rgba(255,255,255,0.7)" size={12} />
            <Text style={styles.gustMetricText}>{post.viewCount ?? 0}</Text>
          </View>
          <View style={styles.gustMetric}>
            <Flame color="#ff9500" fill="#ff9500" size={12} />
            <Text style={styles.gustMetricText}>{post.aura ?? 0}</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function ExploreAuthPrompt({ onLogin }: { onLogin: () => void }) {
  const { isDark, theme } = useAppTheme();
  return (
    <View style={styles.authPrompt}>
      <Image
        contentFit="contain"
        source={noFollowImage}
        style={styles.authPromptImage}
      />
      <Text style={[styles.authPromptTitle, { color: theme.inputText }]}>
        Log in to see your feed
      </Text>
      <Text style={[styles.authPromptBody, { color: theme.dividerText }]}>
        Sign in to see fleets curated just for you.
      </Text>
      <Pressable
        onPress={onLogin}
        style={({ pressed }) => [
          styles.createButton,
          { opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <Gradient3D
          colors={["#ff9500", "#e65500"]}
          radius={8}
          shadows={isDark ? LOGIN_BUTTON_SHADOWS : LOGIN_BUTTON_SHADOWS_LIGHT}
          style={styles.createButtonSurface}
        >
          <Text style={styles.createButtonText}>Log in</Text>
        </Gradient3D>
      </Pressable>
    </View>
  );
}

function ExploreEmptyState({
  activeTab,
  onCreate,
  search,
}: {
  activeTab: ExploreTab;
  onCreate: () => void;
  search: string;
}) {
  const { isDark, theme } = useAppTheme();
  if (activeTab === "gusts") {
    return (
      <View style={styles.empty}>
        <Image
          contentFit="contain"
          source={noMediaImage}
          style={styles.emptyImage}
        />
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          No Gusts yet
        </Text>
        <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
          Explore short-form video clips or share your own high-energy video
          with the community!
        </Text>
        <Pressable
          onPress={onCreate}
          style={({ pressed }) => [
            styles.createButton,
            { opacity: pressed ? 0.88 : 1 },
          ]}
        >
          <Gradient3D
            colors={["#ff9500", "#e65500"]}
            radius={8}
            shadows={isDark ? LOGIN_BUTTON_SHADOWS : LOGIN_BUTTON_SHADOWS_LIGHT}
            style={styles.createButtonSurface}
          >
            <Plus color="#ffffff" size={16} />
            <Text style={styles.createButtonText}>Create the First Gust</Text>
          </Gradient3D>
        </Pressable>
      </View>
    );
  }
  if (activeTab === "people") {
    return (
      <View style={styles.empty}>
        <Image
          contentFit="contain"
          source={noFollowImage}
          style={styles.emptyImage}
        />
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          {search ? `No people found for "${search}"` : "No suggestions yet"}
        </Text>
        <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
          {search
            ? "Try a different name or @username"
            : "Check back later for people trending on asocialmedia."}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Image
        contentFit="contain"
        source={noFollowImage}
        style={styles.emptyImage}
      />
      <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
        {search ? `No results for "${search}"` : "Nothing here yet"}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
        {search
          ? "Try a different name or topic"
          : "Follow people to see their fleets here."}
      </Text>
    </View>
  );
}

function ExplorePeopleHeader({
  loggedIn,
  onRefresh,
}: {
  loggedIn: boolean;
  onRefresh: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.peopleHeader}>
      <View style={styles.peopleHeading}>
        <Text style={[styles.peopleHeadingText, { color: theme.inputText }]}>
          {loggedIn ? "Recommended for you" : "Trending people"}
        </Text>
        {loggedIn ? (
          <Pressable onPress={onRefresh} style={styles.refreshButton}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function errorMessageFor(tab: ExploreTab): string {
  if (tab === "people") {
    return "An error occurred while loading people.";
  }
  if (tab === "gusts") {
    return "Couldn't load Gusts right now. Please try again.";
  }
  return "An error occurred while loading content.";
}

const styles = StyleSheet.create({
  authDock: {
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 60,
  },
  authPrompt: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  authPromptBody: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    textAlign: "center",
  },
  authPromptImage: { height: 128, width: 160 },
  authPromptTitle: { fontFamily: "SofiaProBold", fontSize: 16 },

  createButton: {
    alignItems: "center",
    marginTop: 4,
  },
  createButtonSurface: {
    flexDirection: "row",
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 14,
  },
  createButtonText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 13,
  },
  empty: {
    alignItems: "center",
    gap: 10,
    justifyContent: "center",
    minHeight: 260,
    padding: 24,
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    maxWidth: 320,
    textAlign: "center",
  },
  emptyImage: { height: 120, width: 160 },
  emptyTitle: { fontFamily: "SofiaProMed", fontSize: 15, textAlign: "center" },
  errorState: { paddingHorizontal: 16, paddingVertical: 32 },
  errorText: { fontFamily: "SofiaProReg", fontSize: 14, textAlign: "center" },
  floatingPillWrap: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 40,
  },
  gridCell: { paddingHorizontal: 8 },
  gustAuthorCopy: { flex: 1, minWidth: 0 },
  gustAuthorName: {
    color: "#ffffff",
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 10,
  },
  gustAuthorNameRow: { alignItems: "center", flexDirection: "row", gap: 3 },
  gustAuthorRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  gustBadge: { left: 8, position: "absolute", top: 8 },
  gustContent: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "SofiaProReg",
    fontSize: 10,
    marginTop: 5,
  },
  gustImage: { height: "100%", position: "absolute", width: "100%" },
  gustMetric: { alignItems: "center", flexDirection: "row", gap: 3 },
  gustMetricText: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: "SofiaProReg",
    fontSize: 10,
  },
  gustMetrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  gustOverlay: {
    bottom: 0,
    left: 0,
    padding: 10,
    position: "absolute",
    right: 0,
  },
  gustRail: {
    gap: 12,
    marginBottom: 24,
    marginTop: 16,
  },
  gustRow: { gap: 12, paddingHorizontal: 16 },
  gustTile: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
    width: 144,
  },
  gustTileGrid: {
    marginBottom: 16,
    width: "100%",
  },
  gustUsername: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: "SofiaProReg",
    fontSize: 9,
    marginTop: 1,
  },
  // The pull shifts this view, so the scroll needs to be allowed to fill it
  // and the wrapper needs a positioning context for the absolutely-placed
  // loader.
  listShift: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  peopleHeader: { gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  peopleHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    // Web spaces this row off the first card with `mb-3` on the header
    // wrapper. The list below has no top padding of its own, so without this
    // the heading sits flush against the first card.
    marginBottom: 12,
  },
  peopleHeadingText: { fontFamily: "SofiaProMed", fontSize: 14 },
  pillRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    width: "100%",
  },
  railHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  railSubtitle: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: 2 },
  railTitleGroup: { flex: 1, minWidth: 0 },
  railTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  refreshButton: { paddingHorizontal: 8, paddingVertical: 4 },
  refreshText: { color: "#f97316", fontFamily: "SofiaProMed", fontSize: 12 },
  root: { flex: 1 },
  sectionLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    letterSpacing: 1,
    paddingHorizontal: 16,
    textTransform: "uppercase",
  },
  sectionTitle: { fontFamily: "SofiaProBold", fontSize: 17 },
  seeAll: { fontFamily: "SofiaProMed", fontSize: 12 },
  seeAllRow: { alignItems: "center", flexDirection: "row", gap: 2 },
});
