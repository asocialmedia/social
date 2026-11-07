import {
  matchesAvoidedTopic,
  networkPostRecommended,
} from "@asm/protocols/discovery";
import type { RecommendedAccount } from "@asm/protocols/discovery";
import { FlashList } from "@shopify/flash-list";
import type { FlashListRef, ViewToken } from "@shopify/flash-list";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronRight,
  Clapperboard,
  Eye,
  Flame,
  Plus,
  RefreshCw,
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
import type { ScrollViewInstance, ScrollViewProps } from "react-native";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { iconButton } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { ConcealedMediaCover } from "@/features/feed/components/concealed-media-cover";
import { FeedPager } from "@/features/feed/components/feed-pager";
import { NewContentPill } from "@/features/feed/components/new-content-pill";
import type { PillAuthor } from "@/features/feed/components/new-content-pill";
import { FeedMediaScope } from "@/features/feed/components/post-media";
import { externalPostView } from "@/features/feed/lib/external-post-view";
import { subscribeFeedReads } from "@/features/feed/lib/feed-events";
import { findUnseenRankedItems } from "@/features/feed/lib/feed-types";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { mediaGridImageUrl } from "@/features/feed/lib/media-url";
import { pillAuthors } from "@/features/feed/lib/pill-authors";
import {
  setAutoplayPostId,
  setFeedMediaActive,
  setVisiblePostIds,
} from "@/features/feed/lib/visible-posts";
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
import { useBlueskyFeed } from "@/features/feed/state/use-bluesky-feed";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { getAuraFlameStyle } from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import {
  EMPTY_EXPOSURES,
  useFeedExposures,
} from "@/features/network/state/feed-exposures";
import {
  learnNetworkSearch,
  useDiscoverySuggestions,
} from "@/features/network/state/use-discovery-suggestions";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useNetworkSearch } from "@/features/search/state/use-network-search";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { formatNumber } from "@/lib/format/format-number";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";
import {
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import {
  ExploreApiError,
  blueskyAuthorToPeopleAccount,
  fetchExploreHeadPosts,
  fetchExplorePage,
  fetchExplorePeople,
  fetchExploreTopGusts,
  mutateExploreFollow,
} from "../lib/explore-api";
import type { ExploreUser } from "../lib/explore-api";
import { selectExploreAutoplayPost } from "../lib/explore-autoplay";
import { exploreCache, exploreCacheKey } from "../lib/explore-cache";
import type { ExploreData } from "../lib/explore-cache";
import { hydrateExploreCache } from "../lib/explore-cache-native";
import {
  exploreDisplayStatus,
  peopleDiscoveryStatus,
} from "../lib/explore-display-status";
import { interleaveExploreStream } from "../lib/explore-interleave";
import { exploreFeedTabs, explorePageIndex } from "../lib/explore-navigation";
import { ExploreBadge } from "./explore-badge";
import { ExploreFeedControls } from "./explore-feed-controls";
import { ExploreGuestSearch } from "./explore-guest-search";
import { ExploreNetworkAccount } from "./explore-network-account";
import { ExplorePostCard } from "./explore-post-card";
import { ExploreCommunities, ExploreSearchField } from "./explore-search-parts";
import { ExploreLoadingSkeleton } from "./explore-skeleton";
import { ExploreUserCard } from "./explore-user-card";

type ExploreItem =
  | { kind: "post"; post: FeedPost }
  | { kind: "user"; user: ExploreUser }
  | { kind: "account"; account: RecommendedAccount };

const AnimatedExploreList = createAnimatedComponent(FlashList<ExploreItem>);
const MAINTAIN_POSITION = { disabled: true };
const VIDEO_VIEWABILITY = {
  itemVisiblePercentThreshold: 70,
  minimumViewTime: 300,
};

function itemType(item: ExploreItem): ExploreItem["kind"] {
  return item.kind;
}

function itemKey(item: ExploreItem): string {
  if (item.kind === "post") {
    return `post-${item.post.id}`;
  }
  if (item.kind === "account") {
    return `account-${item.account.source}-${item.account.id}`;
  }
  return `${item.kind}-${item.user.id}`;
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
        <ZephLoader variant="search" color="#f97316" style={styles.root} />
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

const EMPTY_ACCOUNTS: RecommendedAccount[] = [];

// A memoized People user row: the follow/open closures are stable per user,
// so scrolling and unrelated tab state never remount the card. Web never
// highlights these cards (its recommended count over an empty list is zero),
// so highlight stays off.
const PeopleUserRow = memo(
  ({
    onFollowUser,
    onOpenUser,
    user,
    viewerId,
  }: {
    onFollowUser: (userId: string, next: boolean) => Promise<void>;
    onOpenUser: (username: string) => void;
    user: ExploreUser;
    viewerId: string | undefined;
  }) => {
    const handleFollow = useCallback(
      (next: boolean) => onFollowUser(user.id, next),
      [onFollowUser, user.id]
    );
    const handlePress = useCallback(
      () => onOpenUser(user.username),
      [onOpenUser, user.username]
    );
    return (
      <ExploreUserCard
        canFollow={viewerId !== user.id}
        onFollow={handleFollow}
        onPress={handlePress}
        reason={user.reason ?? user.reasons?.[0]}
        user={user}
      />
    );
  }
);
PeopleUserRow.displayName = "PeopleUserRow";

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
    const { isDark, theme } = useAppTheme();
    const network = useNetworkSettings();
    const [search, setSearch] = useState("");
    const [deferredSearch, setDeferredSearch] = useState("");
    // Web fires the people search 300ms after typing settles.
    useEffect(() => {
      const timer = setTimeout(() => setDeferredSearch(search.trim()), 300);
      return () => clearTimeout(timer);
    }, [search]);
    const remoteSearch = useNetworkSearch(
      deferredSearch,
      "bluesky",
      activeTab === "people" ? "user" : "post",
      isActive
    );
    const remote = useBlueskyFeed(
      activeTab === "for-you" ? "personalized" : "trending",
      enabled && isActive && !deferredSearch && activeTab !== "people",
      viewerId,
      false,
      { content: activeTab === "gusts" ? "video" : "all", surface: "explore" }
    );
    const remoteClips = useBlueskyFeed(
      "trending",
      enabled &&
        isActive &&
        !deferredSearch &&
        activeTab !== "gusts" &&
        activeTab !== "people",
      viewerId,
      false,
      { content: "video", surface: "explore" }
    );
    // Web's useDiscoverySuggestions feeds the account cards in the stream,
    // for guests too (their Follow pill asks them to log in), and it is the
    // whole People discovery body: web renders its accounts as the grid, with
    // no users endpoint behind it.
    const suggestionQuery = useDiscoverySuggestions(
      enabled && isActive && activeTab !== "gusts" && !deferredSearch
    );
    const suggestionAccounts = suggestionQuery.data?.accounts;
    const exposures = useFeedExposures(
      (state) => state.seen[network.viewer] ?? EMPTY_EXPOSURES
    );
    const apiBase = getApiBaseUrl();
    const cacheKey = exploreCacheKey(
      apiBase,
      viewerId,
      activeTab,
      `${network.scope}:${network.locale}:${deferredSearch}`
    );
    const mediaScope = `explore:${cacheKey}`;
    const mediaActive = useRef(isActive);
    const visiblePosts = useRef<FeedPost[]>([]);
    const autoplayPost = useRef<string | null>(null);
    useEffect(() => {
      mediaActive.current = isActive;
      setFeedMediaActive(mediaScope, isActive);
      if (!isActive) {
        return;
      }
      setVisiblePostIds(new Set(visiblePosts.current.map((post) => post.id)));
      setAutoplayPostId(autoplayPost.current);
      return () => {
        mediaActive.current = false;
        setFeedMediaActive(mediaScope, false);
        setVisiblePostIds(new Set());
        setAutoplayPostId(null);
      };
    }, [isActive, mediaScope]);
    const handleViewableItemsChanged = useCallback(
      ({ viewableItems }: { viewableItems: ViewToken<ExploreItem>[] }) => {
        const viewablePosts = viewableItems.flatMap(({ item, isViewable }) =>
          isViewable && item.kind === "post" ? [item.post] : []
        );
        visiblePosts.current = viewablePosts;
        autoplayPost.current = selectExploreAutoplayPost(
          viewablePosts,
          autoplayPost.current
        );
        if (mediaActive.current) {
          setVisiblePostIds(new Set(viewablePosts.map((post) => post.id)));
          setAutoplayPostId(autoplayPost.current);
        }
      },
      []
    );
    const resource = useSyncExternalStore(exploreCache.subscribe, () =>
      exploreCache.read(cacheKey)
    );
    const {
      communities,
      posts: asmPosts,
      users,
      gusts: asmGusts,
      nextCursor,
    } = resource.data ?? EMPTY_DATA;
    const eligible = useCallback(
      (post: FeedPost) =>
        network.ready &&
        !exposures.has(post.id) &&
        networkPostRecommended(
          post,
          network.settings.preferences,
          network.settings.topicScope
        ),
      [
        network.ready,
        network.settings.preferences,
        network.settings.topicScope,
        exposures,
      ]
    );
    const externalPosts = (
      deferredSearch ? remoteSearch.bluesky.posts : remote.posts
    )
      .map(externalPostView)
      .map((post) =>
        activeTab === "gusts" ? { ...post, isGust: true } : post
      );
    const posts = mixExplorePosts(asmPosts, externalPosts)
      .filter(eligible)
      .filter(
        (post) =>
          activeTab !== "gusts" ||
          post.attachments?.some((media) => media.type === "VIDEO")
      );
    // Web's ExploreGustsRail: moderated clips never show, and the rail stops
    // at 32 tiles.
    const gusts = mixExplorePosts(
      asmGusts,
      remoteClips.posts.map((post) => ({
        ...externalPostView(post),
        isGust: true,
      }))
    )
      .filter((post) => eligible(post) && !post.moderated)
      .slice(0, 32);
    const hasGustRail =
      gusts.length > 0 &&
      activeTab !== "gusts" &&
      activeTab !== "people" &&
      !deferredSearch;
    const railIcon = iconButton(isDark);
    // Web's People discovery is the suggestions query alone: the accounts
    // are the body, so the status follows them and not the explore cache.
    const peopleDiscovery = activeTab === "people" && !deferredSearch;
    // Web's People search maps remote profiles to suggestion accounts and
    // drops authors matching the reader's avoided topics.
    const blueskyPeople = useMemo<RecommendedAccount[]>(() => {
      if (activeTab !== "people" || !deferredSearch) {
        return EMPTY_ACCOUNTS;
      }
      const avoided = network.settings.preferences.avoidedTopics;
      return remoteSearch.bluesky.profiles
        .filter(
          (author) =>
            !matchesAvoidedTopic(
              `${author.displayName} ${author.description ?? ""}`,
              author.labels,
              avoided
            )
        )
        .map(blueskyAuthorToPeopleAccount);
    }, [
      activeTab,
      deferredSearch,
      remoteSearch.bluesky.profiles,
      network.settings.preferences.avoidedTopics,
    ]);
    let blueskyStatus: typeof remote.status | undefined;
    if (!deferredSearch && activeTab !== "people") {
      blueskyStatus = remote.status;
    } else if (deferredSearch.length >= 2) {
      blueskyStatus = "success";
      if (remoteSearch.remoteLoading) {
        blueskyStatus = "loading";
      } else if (remoteSearch.remoteError) {
        blueskyStatus = "error";
      }
    }
    const accounts = suggestionAccounts ?? EMPTY_ACCOUNTS;
    const status = peopleDiscovery
      ? peopleDiscoveryStatus(
          accounts.length > 0,
          suggestionQuery.loading,
          suggestionQuery.error
        )
      : exploreDisplayStatus(
          posts.length > 0 ||
            users.length > 0 ||
            (activeTab === "people" && blueskyPeople.length > 0) ||
            (activeTab !== "gusts" &&
              activeTab !== "people" &&
              gusts.length > 0),
          resource,
          blueskyStatus
        );
    // A suggestions refetch reads like a refresh when cards are on screen.
    const refreshing = peopleDiscovery
      ? suggestionQuery.loading && accounts.length > 0
      : resource.pending === "refresh";
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
        if (activeTab === "people" && !deferredSearch) {
          // Discovery renders the suggestions query, not a cached page.
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
            const options = {
              apiBase,
              cookie: await authClient.getCookie(),
              network: { ...network.request, surface: "explore" as const },
            };
            const [page, topGusts] = await Promise.all([
              activeTab === "people"
                ? fetchExplorePeople(deferredSearch, options)
                : fetchExplorePage(activeTab, deferredSearch, cursor, options),
              // Web hides the rail while searching, so a search skips it.
              !append &&
              !deferredSearch &&
              (activeTab === "for-you" || activeTab === "trending")
                ? fetchExploreTopGusts(options)
                : Promise.resolve([]),
            ]);
            return { ...page, gusts: topGusts };
          },
          append ? "append" : replacementMode,
          cursor ?? undefined
        );
      },
      [activeTab, apiBase, cacheKey, deferredSearch, viewerId, network.request]
    );

    useEffect(() => {
      if (
        !network.ready ||
        (!enabled && !isActive) ||
        (isPending && !viewerId)
      ) {
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
    }, [enabled, isActive, isPending, load, viewerId, network.ready]);

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

    // Feed events offer new posts behind a pill without replacing the visible grid. The probe diffs the head against what is already on screen and
    // never rewrites the list on its own; tapping the pill prepends and scrolls to top.
    const knownIdsRef = useRef<Set<string>>(new Set());
    const probeKeyRef = useRef("");
    const probeTab = activeTab;
    const probeSearch = deferredSearch;

    useEffect(() => {
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
              network: { ...network.request, surface: "explore" as const },
            }
          );
          if (
            cancelled ||
            probeKeyRef.current !== key ||
            knownIdsRef.current.size === 0
          ) {
            return;
          }
          const unseen = findUnseenRankedItems(headPosts, knownIdsRef.current);
          if (unseen.length > 0) {
            setNewItems(unseen.filter(eligible));
          }
        } catch (error) {
          logWarn("explore.probe_failed", {
            reason: error instanceof Error ? error.message : String(error),
            tab: probeTab,
          });
        }
      };
      const unsubscribe = subscribeFeedReads(
        viewerId || undefined,
        "asm",
        probe
      );
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [
      cacheKey,
      isActive,
      probeTab,
      probeSearch,
      status,
      viewerId,
      network.request,
      eligible,
    ]);

    const [headKey, setHeadKey] = useState(cacheKey);
    if (headKey !== cacheKey) {
      setHeadKey(cacheKey);
      setNewItems([]);
    }
    const showNewItems = useCallback(() => {
      remote.acceptNew();
      if (newItems.length === 0) {
        return;
      }
      logInfo("explore.new_shown", { count: newItems.length, tab: activeTab });
      exploreCache.prepend(cacheKey, newItems.filter(eligible));
      setNewItems([]);
      scrollViewRef.current?.scrollToOffset({ animated: true, offset: 0 });
    }, [activeTab, cacheKey, newItems, remote, eligible]);

    const newItemAuthors: PillAuthor[] = pillAuthors(newItems);

    const refresh = useCallback(() => {
      if (peopleDiscovery) {
        // Web's Refresh pill asks the suggestions endpoint for a new set.
        void suggestionQuery.refetch();
        return;
      }
      void load(null, false, true);
      void remote.refresh();
      void remoteClips.refresh();
      remoteSearch.retry();
    }, [
      load,
      peopleDiscovery,
      remote,
      remoteClips,
      remoteSearch,
      suggestionQuery,
    ]);

    const handleCreateGust = () => {
      router.push(
        viewerId
          ? { params: { create: "true" }, pathname: "/gusts" }
          : "/(auth)/login"
      );
    };

    const fetchMore = useCallback(() => {
      if (isActive && !deferredSearch) {
        void remote.fetchNext();
      }
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
      deferredSearch,
      remote,
    ]);

    const items = useMemo<ExploreItem[]>(() => {
      if (activeTab === "people") {
        if (deferredSearch) {
          // Web's People search order: Bluesky accounts first, then people.
          return [
            ...blueskyPeople.map((account) => ({
              account,
              kind: "account" as const,
            })),
            ...users.map((person) => ({ kind: "user" as const, user: person })),
          ];
        }
        // Web's People discovery is the suggestions accounts alone: no user
        // cards, no posts, no highlight treatment.
        return accounts.map((account) => ({
          account,
          kind: "account" as const,
        }));
      }
      // Web's items memo: user cards in every sixth search slot, and the
      // next recommended account after every sixth post outside search.
      return interleaveExploreStream(
        posts,
        users,
        activeTab === "gusts" ? EMPTY_ACCOUNTS : accounts,
        Boolean(deferredSearch)
      );
    }, [accounts, activeTab, blueskyPeople, posts, deferredSearch, users]);

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
      (props: ScrollViewProps & { ref?: Ref<ScrollViewInstance> }) => (
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

    const openUser = useCallback(
      (username: string) => {
        router.push({
          params: { username },
          pathname: "/users/[username]",
        });
      },
      [router]
    );

    const renderItem = useCallback(
      ({ item }: { item: ExploreItem }) => {
        if (item.kind === "account") {
          return <ExploreNetworkAccount account={item.account} />;
        }
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
                router.push(
                  item.post.external
                    ? {
                        params: { uri: item.post.id },
                        pathname: "/external-post",
                      }
                    : {
                        params: { postId: item.post.id },
                        pathname: "/posts/[postId]",
                      }
                )
              }
              onRequireLogin={() => router.push("/(auth)/login")}
              post={item.post}
              viewerId={viewerId ?? null}
            />
          );
        }
        return (
          <PeopleUserRow
            onFollowUser={handleFollow}
            onOpenUser={openUser}
            user={item.user}
            viewerId={viewerId}
          />
        );
      },
      [activeTab, handleFollow, openUser, router, viewerId]
    );

    const showPill =
      newItems.length + remote.newItems.length > 0 &&
      activeTab !== "gusts" &&
      activeTab !== "people" &&
      !deferredSearch;

    const submitSearchLearning = useCallback(() => {
      // Web learns the query when the reader submits the people search.
      void learnNetworkSearch(viewerId ?? "guest", search);
    }, [search, viewerId]);

    const header = (
      <View style={{ marginHorizontal: activeTab === "people" ? -16 : -8 }}>
        {/* Web gives guests only the guest search bar and hides the field on
            the Gusts tab; signed-in viewers search in place. */}
        {viewerId && activeTab !== "gusts" ? (
          <ExploreSearchField
            fetching={
              Boolean(deferredSearch) &&
              (resource.pending !== null ||
                (activeTab === "people" && remoteSearch.remoteLoading))
            }
            onChange={setSearch}
            onSubmit={activeTab === "people" ? submitSearchLearning : undefined}
            value={search}
          />
        ) : null}
        {remote.error || remoteSearch.remoteError ? (
          <View className="gap-2 p-3">
            <Text style={{ color: theme.dividerText }}>
              {activeTab === "people"
                ? "Bluesky search is temporarily unavailable."
                : "Bluesky is temporarily unavailable. Available results are shown."}
            </Text>
            <SettingsButton
              tone="gray"
              label="Retry Bluesky"
              onPress={() => {
                void remote.refresh();
                remoteSearch.retry();
              }}
            />
          </View>
        ) : null}
        {activeTab === "people" ? (
          <ExplorePeopleHeader
            loggedIn={Boolean(viewerId)}
            onRefresh={refresh}
            refreshing={refreshing}
          />
        ) : null}
        {activeTab === "people" &&
        !deferredSearch &&
        suggestionQuery.data?.partial ? (
          <View className="gap-2 p-3">
            <Text style={{ color: theme.dividerText, fontSize: 12 }}>
              Some network suggestions are temporarily unavailable.
            </Text>
          </View>
        ) : null}
        {showPill && !isScrolledDown ? (
          <View style={styles.pillRow}>
            <NewContentPill
              authors={newItemAuthors}
              count={newItems.length + remote.newItems.length}
              floating={false}
              onPress={showNewItems}
            />
          </View>
        ) : null}
        {hasGustRail ? (
          <View
            accessibilityLabel="Trending Gusts"
            style={styles.gustRail}
            testID="explore-gusts-rail"
          >
            <View style={styles.railHeading}>
              <View style={styles.railTitleRow}>
                {/* Web's `icon-btn-3d size-9 rounded-xl` icon well. */}
                <View
                  style={[
                    styles.railIconWell,
                    {
                      backgroundColor: railIcon.background,
                      boxShadow: railIcon.shadows,
                    },
                  ]}
                >
                  <Clapperboard color="#f97316" size={18} />
                </View>
                <View style={styles.railTitleGroup}>
                  <Text
                    style={[styles.sectionTitle, { color: theme.inputText }]}
                  >
                    Trending Gusts
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.railSubtitle, { color: theme.dividerText }]}
                  >
                    Taking off across your networks
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="See all Gusts"
                accessibilityRole="button"
                hitSlop={8}
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
        {deferredSearch && communities.length > 0 && activeTab !== "people" ? (
          <ExploreCommunities communities={communities} />
        ) : null}
        {hasGustRail && items.length > 0 ? (
          <Text
            accessibilityRole="header"
            style={[styles.moreHeading, { color: theme.inputText }]}
          >
            More to explore
          </Text>
        ) : null}
      </View>
    );

    let empty: React.ReactNode = null;
    if (activeTab === "for-you" && !viewerId && !isPending) {
      empty = (
        <ExploreAuthPrompt onLogin={() => router.push("/(auth)/login")} />
      );
    } else if (!network.ready && network.error) {
      // Web's first branch: without feed preferences nothing can be ranked,
      // so the reader retries the preferences rather than the feed.
      empty = (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: theme.errorBannerText }]}>
            We couldn’t load your feed preferences. Please try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void network.refetch();
            }}
            style={styles.refreshButton}
          >
            <Text style={styles.refreshText}>Retry</Text>
          </Pressable>
        </View>
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
          loggedIn={Boolean(viewerId)}
          onCreate={handleCreateGust}
          search={deferredSearch}
        />
      );
    }

    let footer: React.ReactNode = null;
    if (resource.error && status === "success") {
      footer = (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: theme.errorBannerText }]}>
            {activeTab === "gusts"
              ? "Some Gusts couldn’t load. Please try again in a moment."
              : "Some recommendations couldn’t load. Please try again in a moment."}
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
      <FeedMediaScope.Provider value={mediaScope}>
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
                onViewableItemsChanged={handleViewableItemsChanged}
                viewabilityConfig={VIDEO_VIEWABILITY}
                onEndReached={fetchMore}
                onEndReachedThreshold={0.5}
                onScroll={handleContentScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
                ListHeaderComponent={header ?? undefined}
                ListEmptyComponent={empty ?? undefined}
                ListFooterComponent={footer ?? undefined}
                renderItem={({ item }) => (
                  <View
                    style={activeTab === "people" ? undefined : styles.gridCell}
                  >
                    {renderItem({ item })}
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
                  count={newItems.length + remote.newItems.length}
                  floating={false}
                  onPress={showNewItems}
                />
              </View>
            ) : null}
          </View>
        </GestureDetector>
      </FeedMediaScope.Provider>
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
  // Web's grid and rail both drop a moderated gust entirely.
  if (!media || post.moderated) {
    return null;
  }
  const imageUrl = mediaGridImageUrl(getApiBaseUrl(), media);
  const aura = post.external?.asm?.amplifications ?? post.aura ?? 0;
  const flame = getAuraFlameStyle(aura);
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
      {post.explicitContent ? (
        <ConcealedMediaCover
          accessibilityLabel="Blurred explicit media preview"
          apiBase={getApiBaseUrl()}
          media={media}
        />
      ) : (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          source={{ uri: imageUrl }}
          style={styles.gustImage}
        />
      )}
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
          {post.external ? (
            <Text style={styles.gustMetricText}>Bluesky</Text>
          ) : (
            <View style={styles.gustMetric}>
              <Eye color="rgba(255,255,255,0.7)" size={12} />
              <Text style={styles.gustMetricText}>
                {formatNumber(post.viewCount ?? 0)}
              </Text>
            </View>
          )}
          <View style={styles.gustMetric}>
            {/* Web's getAuraFlameClass tier colour, not a fixed orange. */}
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "transparent"}
              size={12}
            />
            <Text style={styles.gustMetricText}>{formatNumber(aura)}</Text>
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

function peopleEmptyHint(search: string, loggedIn: boolean): string {
  if (search) {
    return "Try a different name or @username";
  }
  if (loggedIn) {
    return "Follow more people or post with tags to get personalized suggestions.";
  }
  return "Check back later for people trending on asocialmedia.";
}

function ExploreEmptyState({
  activeTab,
  loggedIn,
  onCreate,
  search,
}: {
  activeTab: ExploreTab;
  loggedIn: boolean;
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
          {peopleEmptyHint(search, loggedIn)}
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
  refreshing,
}: {
  loggedIn: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.peopleHeader}>
      <View style={styles.peopleHeading}>
        <Text style={[styles.peopleHeadingText, { color: theme.inputText }]}>
          {loggedIn ? "Recommended for you" : "Trending people"}
        </Text>
        {loggedIn ? (
          <Pressable
            accessibilityLabel="Refresh suggestions"
            accessibilityRole="button"
            accessibilityState={{ disabled: refreshing }}
            disabled={refreshing}
            onPress={onRefresh}
            style={({ pressed }) => [
              styles.refreshButton,
              styles.refreshPill,
              pressed && !refreshing ? styles.keyPressed : null,
            ]}
          >
            <RefreshCw
              color={refreshing ? theme.dividerText : "#f97316"}
              size={14}
            />
            <Text
              style={[
                styles.refreshText,
                { color: refreshing ? theme.dividerText : "#f97316" },
              ]}
            >
              Refresh
            </Text>
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
    return "Couldn’t load Gusts right now. Please try again.";
  }
  return "We couldn’t load recommendations right now. Please try again in a moment.";
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
  keyPressed: {
    transform: [{ translateY: 1 }],
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
  moreHeading: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
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
  railIconWell: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  railSubtitle: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 1 },
  railTitleGroup: { flex: 1, minWidth: 0 },
  railTitleRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },

  refreshButton: { paddingHorizontal: 8, paddingVertical: 4 },
  refreshPill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  refreshText: { color: "#f97316", fontFamily: "SofiaProMed", fontSize: 12 },
  root: { flex: 1 },
  sectionLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    letterSpacing: 1,
    paddingHorizontal: 16,
    textTransform: "uppercase",
  },
  sectionTitle: { fontFamily: "SofiaProBold", fontSize: 14 },
  seeAll: { fontFamily: "SofiaProMed", fontSize: 12 },
  seeAllRow: { alignItems: "center", flexDirection: "row", gap: 2 },
});

function mixExplorePosts(asm: FeedPost[], remote: FeedPost[]): FeedPost[] {
  const result: FeedPost[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.max(asm.length, remote.length); index += 1) {
    for (const post of [asm[index], remote[index]]) {
      if (post && !seen.has(post.id)) {
        seen.add(post.id);
        result.push(post);
      }
    }
  }
  return result;
}
