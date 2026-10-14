import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import {
  FileText,
  Info,
  LayoutGrid,
  Plus,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useAnimatedValue,
  View,
} from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import bannerAsm from "@/assets/images/banner-asm.png";
import noSearchImage from "@/assets/images/nosearch.png";
import zephImage from "@/assets/images/zeph.png";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { IconButton3D } from "@/components/surface/icon-button-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  HEADER_BAR_HEIGHT,
  reportFeedScroll,
  resetHeaderScroll,
  subscribeHeaderVisibility,
} from "@/features/feed/lib/header-visibility";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import {
  headerSlide,
  MobileHeader,
} from "@/features/home/components/mobile-header";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/api-env";
import { bottomDockPadding } from "@/lib/bottom-dock-layout";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import {
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  NAV_ACTIVE_SHADOWS,
  NAV_ACTIVE_SHADOWS_DARK,
  SEARCH_PANEL_SHADOWS,
  SEARCH_PANEL_SHADOWS_DARK,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import {
  COMMUNITY_DISCOVERY_CATEGORIES,
  fetchCommunitiesPage,
  fetchCreationQuota,
} from "../lib/communities-api";
import type {
  CommunityCategory,
  CommunityData,
  CommunityPage,
  CommunityCreationQuota,
} from "../lib/communities-api";
import {
  communityDiscoveryRows,
  COMMUNITY_SEARCH_ROW_INDEX,
  COMMUNITY_PAGE_GUTTER,
} from "../lib/community-discovery";
import type { CommunityDiscoveryRow } from "../lib/community-discovery";
import { CommunityCard } from "./community-card";
import { CommunityCreateDialog } from "./community-create-dialog";
import { CommunityCreationGate } from "./community-creation-gate";
import { CommunityRail } from "./community-rail";

function number(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(".0", "")}k`;
  }
  return value.toLocaleString();
}

export function CommunitiesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    search?: string | string[];
    create?: string;
  }>();
  const { isPending, user } = useSessionContext();
  const insets = useSafeAreaInsets();
  const { isDark, theme } = useAppTheme();

  const initialSearch = Array.isArray(params.search)
    ? params.search[0]
    : params.search;
  const [search, setSearch] = useState(initialSearch ?? "");
  const [deferredSearch, setDeferredSearch] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDeferredSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const focused = useIsFocused();
  const scrollY = useAnimatedValue(0);
  const [heroHeight, setHeroHeight] = useState(0);
  const [searchHeight, setSearchHeight] = useState(0);
  const [firstRailSize, setFirstRailSize] = useState({ height: 0, key: "" });
  const [searchStuck, setSearchStuck] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [categoryHeight, setCategoryHeight] = useState(46);
  useEffect(() => subscribeHeaderVisibility(setHeaderHidden), []);
  useEffect(() => {
    if (focused) {
      resetHeaderScroll();
    }
  }, [focused]);
  const followUp = headerSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_BAR_HEIGHT],
  });
  const [category, setCategory] = useState<CommunityCategory>("all");
  const [page, setPage] = useState<CommunityPage | null>(null);
  const [communities, setCommunities] = useState<CommunityData[]>([]);
  const [status, setStatus] = useState<"error" | "loading" | "success">(
    "loading"
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dockHeight, setDockHeight] = useState(56);
  const [guestBarHeight, setGuestBarHeight] = useState(72);
  const showGuestBar = !isPending && !user;
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (params.create === "1" && !isPending) {
      router.setParams({ create: undefined });
      if (user) {
        // oxlint-disable-next-line react/set-state-in-effect -- Consume a navigation command on the existing directory screen.
        setCreateOpen(true);
      } else {
        router.push("/(auth)/login");
      }
    }
  }, [params.create, isPending, user, router]);
  const [quotaResult, setQuotaResult] = useState<{
    userId: string;
    value: CommunityCreationQuota | null;
  } | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const viewerId = user?.id;
  const quota = quotaResult?.userId === viewerId ? quotaResult?.value : null;

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!viewerId) {
        return;
      }
      try {
        const result = await fetchCreationQuota({
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (active) {
          setQuotaResult({ userId: viewerId, value: result });
        }
      } catch {
        // The server checks eligibility again when the community is submitted.
      }
    })();
    return () => {
      active = false;
    };
  }, [viewerId]);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      const cookie = await authClient.getCookie();
      const result = await fetchCommunitiesPage(
        { category, cursor, query: deferredSearch },
        { apiBase: getApiBaseUrl(), cookie }
      );
      setPage(result);
      setCommunities((current) =>
        append
          ? [
              ...current,
              ...result.communities.filter(
                (community) => !current.some((item) => item.id === community.id)
              ),
            ]
          : result.communities
      );
      setStatus("success");
    },
    [category, deferredSearch]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const cookie = viewerId ? await authClient.getCookie() : "";
      if (!active) {
        return;
      }
      setStatus("loading");
      setCommunities([]);
      try {
        const result = await fetchCommunitiesPage(
          { category, cursor: null, query: deferredSearch },
          { apiBase: getApiBaseUrl(), cookie }
        );
        if (active) {
          setPage(result);
          setCommunities(result.communities);
          setStatus("success");
        }
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [category, deferredSearch, viewerId]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(null, false);
    } catch {
      setStatus("error");
      setRefreshing(false);
      return;
    }
    setRefreshing(false);
  };

  // The same 3D pull loader the feed uses, not the stock RefreshControl, so a
  // refresh here reads identically to a refresh there.
  const pull = usePullToRefresh({
    failed: status === "error",
    onRefresh: refresh,
    refreshing,
    updatedMessage: "Communities updated",
  });

  const loadMore = async () => {
    if (loadingMore || !page?.nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      await load(page.nextCursor, true);
    } catch {
      setStatus("error");
      setLoadingMore(false);
      return;
    }
    setLoadingMore(false);
  };

  const openCommunity = useCallback(
    (community: CommunityData) =>
      router.push({ params: { slug: community.slug }, pathname: "/a/[slug]" }),
    [router]
  );

  const handleCreate = () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    if (quota && !quota.canCreate) {
      setGateOpen(true);
      return;
    }
    setCreateOpen(true);
  };
  const closeCreate = () => {
    setCreateOpen(false);
  };

  const showRails = !deferredSearch && category === "all";
  const activeLabel =
    COMMUNITY_DISCOVERY_CATEGORIES.find((item) => item.key === category)
      ?.label ?? "All";
  let browseHeading = category === "all" ? "All communities" : activeLabel;
  if (deferredSearch) {
    browseHeading = `Results for “${deferredSearch}”`;
  }
  const rows = communityDiscoveryRows({ communities, page, showRails });
  const firstRail = rows.find((row) => row.kind === "rail");
  const washHeight =
    categoryHeight +
    heroHeight +
    searchHeight +
    (firstRail && firstRailSize.key === firstRail.key
      ? firstRailSize.height
      : 0) +
    28;
  const stats = page?.stats ?? { communities: 0, members: 0, posts: 0 };
  const counts = page?.counts ?? {};

  const categoryBar = (
    <View
      onLayout={(event) => setCategoryHeight(event.nativeEvent.layout.height)}
      style={[
        styles.categoryBar,
        {
          backgroundColor: theme.backgroundAlt,
          borderBottomColor: theme.cardBorder,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.categoryRow}
        horizontal
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
      >
        {COMMUNITY_DISCOVERY_CATEGORIES.map((item) => {
          const active = item.key === category;
          const count = counts[item.key];
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.key}
              onPress={() => setCategory(item.key)}
              style={[
                styles.category,
                styles.categoryInactive,
                active && {
                  backgroundColor: "#f973261a",
                  borderColor: "#f9732640",
                  boxShadow: isDark
                    ? NAV_ACTIVE_SHADOWS_DARK
                    : NAV_ACTIVE_SHADOWS,
                },
              ]}
            >
              <Text
                style={[
                  styles.categoryText,
                  { color: active ? "#f97316" : theme.dividerText },
                ]}
              >
                {item.label}
              </Text>
              <Text
                style={[
                  styles.categoryCount,
                  {
                    color: active ? "#f97316" : theme.dividerText,
                    opacity: 0.7,
                  },
                ]}
              >
                {count === undefined ? "—" : number(count)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const empty: React.ReactNode =
    status === "loading" ? (
      <CommunityLoadingState />
    ) : (
      <CommunityEmptyState
        activeLabel={activeLabel}
        failed={status === "error"}
        onRetry={() => {
          void refresh();
        }}
        searching={Boolean(deferredSearch)}
      />
    );

  const hero = (
    <View
      style={styles.hero}
      onLayout={(event) => setHeroHeight(event.nativeEvent.layout.height)}
    >
      <View style={styles.heroContent}>
        <View style={styles.heroHeadline}>
          <View style={styles.heroStatement}>
            <Text style={[styles.heroTitle, { color: theme.inputText }]}>
              Discover your
            </Text>
            <View style={styles.heroTitleRow}>
              <Text style={[styles.heroTitle, { color: theme.inputText }]}>
                next
              </Text>
              <Image
                contentFit="contain"
                source={zephImage}
                style={styles.heroMark}
              />
              <Text style={[styles.heroTitle, { color: theme.inputText }]}>
                community
              </Text>
            </View>
          </View>
          {quota && !quota.canCreate ? (
            <View style={styles.creationInfo}>
              <IconButton3D
                accessibilityLabel="Why can’t I create a community?"
                icon={Info}
                onPress={() => setGateOpen(true)}
                size={32}
              />
            </View>
          ) : null}
        </View>
        <Text style={[styles.heroBody, { color: theme.dividerText }]}>
          Find a new space to play, chill, and hang out.
        </Text>
        <View style={styles.createAction}>
          {quota && !quota.canCreate ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={handleCreate}
              style={({ pressed }) => [
                styles.createButton,
                { opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Gradient3D
                colors={["#ff9500", "#e65500"]}
                radius={8}
                shadows={
                  isDark ? LOGIN_BUTTON_SHADOWS : LOGIN_BUTTON_SHADOWS_LIGHT
                }
                style={styles.createButtonSurface}
              >
                <Plus color="#ffffff" size={16} strokeWidth={4} />
                <Text style={styles.createButtonText}>Create community</Text>
              </Gradient3D>
            </Pressable>
          )}
        </View>
        <View
          style={[
            styles.statsPanel,
            {
              backgroundColor: theme.backgroundAlt,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <View style={styles.stat}>
            <View style={styles.statLabel}>
              <Users color="#f97316" fill="#f97316" size={14} />
              <Text
                style={[styles.statLabelText, { color: theme.dividerText }]}
              >
                Communities
              </Text>
            </View>
            <Text style={[styles.statValue, { color: theme.inputText }]}>
              {number(stats.communities)}
            </Text>
          </View>
          <View style={styles.stat}>
            <View style={styles.statLabel}>
              <UserRound color="#f97316" fill="#f97316" size={14} />
              <Text
                style={[styles.statLabelText, { color: theme.dividerText }]}
              >
                Members
              </Text>
            </View>
            <Text style={[styles.statValue, { color: theme.inputText }]}>
              {number(stats.members)}
            </Text>
          </View>
          <View style={styles.stat}>
            <View style={styles.statLabel}>
              <FileText color="#f97316" fill="#f97316" size={14} />
              <Text
                style={[styles.statLabelText, { color: theme.dividerText }]}
              >
                Posts
              </Text>
            </View>
            <Text style={[styles.statValue, { color: theme.inputText }]}>
              {number(stats.posts)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
  const searchBand = (
    <View
      onLayout={(event) => setSearchHeight(event.nativeEvent.layout.height)}
      style={[
        styles.searchBand,
        searchStuck && { backgroundColor: theme.backgroundAlt },
      ]}
    >
      <View
        style={[
          styles.search,
          {
            backgroundColor: theme.containerBg,
            borderColor: theme.inputBorder,
            boxShadow: isDark
              ? SEARCH_PANEL_SHADOWS_DARK
              : SEARCH_PANEL_SHADOWS,
          },
        ]}
      >
        <Search color={theme.dividerText} size={16} />
        <TextInput
          accessibilityLabel="Search communities"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder="Search communities"
          placeholderTextColor={theme.dividerText}
          style={styles.searchInput}
          value={search}
        />
        {search ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setSearch("")}
          >
            <X color={theme.dividerText} size={16} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
  const browse = (
    <View>
      <View style={styles.browseHeading}>
        <LayoutGrid color="#f97316" fill="#f97316" size={20} />
        <Text style={[styles.browseTitle, { color: theme.inputText }]}>
          {browseHeading}
        </Text>
      </View>
      <View style={styles.browseCountRow}>
        <Text style={[styles.countStrong, { color: theme.inputText }]}>
          {number(page?.total ?? 0)}
        </Text>
        <Text style={[styles.countLabel, { color: theme.dividerText }]}>
          {" "}
          Results Found
        </Text>
        {status === "loading" || search.trim() !== deferredSearch ? (
          <Text style={[styles.refreshLabel, { color: theme.dividerText }]}>
            Refreshing…
          </Text>
        ) : null}
      </View>
    </View>
  );

  const renderRow = ({ item }: { item: CommunityDiscoveryRow }) => {
    if (item.kind === "hero") {
      return hero;
    }
    if (item.kind === "search") {
      return searchBand;
    }
    if (item.kind === "browse") {
      return browse;
    }
    if (item.kind === "state") {
      return empty;
    }
    if (item.kind === "rail") {
      return (
        <View
          onLayout={
            item.key === firstRail?.key
              ? (event) =>
                  setFirstRailSize({
                    height: event.nativeEvent.layout.height,
                    key: item.key,
                  })
              : undefined
          }
          style={[styles.rail, item.key === "growing" && styles.growingRail]}
        >
          <CommunityRail
            auras={page?.auras ?? {}}
            communities={item.communities}
            icon={item.icon}
            onOpen={openCommunity}
            title={item.title}
          />
        </View>
      );
    }
    return (
      <View style={styles.cardWrap}>
        <CommunityCard
          aura={page?.auras[item.community.id] ?? 0}
          community={item.community}
          onPress={() => openCommunity(item.community)}
        />
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundAlt }]}>
      <MobileHeader
        user={user ? { ...user, username: user.username ?? user.name } : null}
      />
      <Animated.View
        style={[
          styles.chromeFollow,
          {
            marginBottom: -HEADER_BAR_HEIGHT,
            transform: [{ translateY: followUp }],
          },
        ]}
      >
        {categoryBar}
        <GestureDetector gesture={pull.gesture}>
          <View style={styles.listWrap}>
            <Animated.View
              style={[
                styles.listShift,
                { transform: [{ translateY: pull.pullShift }] },
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.wash,
                  {
                    height: washHeight,
                    top: -categoryHeight,
                    transform: [{ translateY: Animated.multiply(scrollY, -1) }],
                  },
                ]}
              >
                <Image
                  source={bannerAsm}
                  contentFit="cover"
                  style={[
                    StyleSheet.absoluteFill,
                    { opacity: isDark ? 0.15 : 0.2 },
                  ]}
                />
                <LinearGradient
                  colors={[
                    theme.backgroundAlt,
                    "transparent",
                    "transparent",
                    theme.backgroundAlt,
                  ]}
                  locations={[
                    0,
                    Math.min(0.45, 96 / Math.max(1, washHeight)),
                    Math.max(0.55, 1 - 28 / Math.max(1, washHeight)),
                    1,
                  ]}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <GestureDetector gesture={pull.nativeScrollGesture}>
                <Animated.FlatList
                  {...LIST_VIRTUALIZATION_PROPS}
                  ListFooterComponent={
                    loadingMore ? (
                      <ActivityIndicator
                        color="#f97316"
                        style={styles.footer}
                      />
                    ) : null
                  }
                  contentContainerStyle={[
                    styles.content,
                    {
                      paddingBottom:
                        (headerHidden ? 0 : HEADER_BAR_HEIGHT) +
                        bottomDockPadding({
                          bottomInset: insets.bottom,
                          dockHeight: headerHidden ? 0 : dockHeight,
                          guestBarHeight: showGuestBar
                            ? guestBarHeight + 12
                            : 0,
                        }),
                    },
                  ]}
                  contentInsetAdjustmentBehavior="automatic"
                  data={rows}
                  keyExtractor={(row) => row.key}
                  stickyHeaderIndices={[COMMUNITY_SEARCH_ROW_INDEX]}
                  removeClippedSubviews={false}
                  onEndReached={loadMore}
                  onEndReachedThreshold={0.6}
                  onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                    {
                      listener: (
                        event: NativeSyntheticEvent<NativeScrollEvent>
                      ) => {
                        pull.onScroll(event);
                        const offset = event.nativeEvent.contentOffset.y;
                        setSearchStuck(offset >= heroHeight - 1);
                        if (focused) {
                          reportFeedScroll(offset);
                        }
                      },
                      useNativeDriver: true,
                    }
                  )}
                  scrollEventThrottle={16}
                  onScrollEndDrag={() => pull.onScrollEndDrag()}
                  renderItem={renderRow}
                  showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
                />
              </GestureDetector>
            </Animated.View>
            {pull.loader}
          </View>
        </GestureDetector>
      </Animated.View>
      {showGuestBar ? (
        <View
          onLayout={(event) =>
            setGuestBarHeight(event.nativeEvent.layout.height)
          }
          pointerEvents="box-none"
          style={[styles.authDock, { bottom: dockHeight + insets.bottom + 12 }]}
        >
          <GuestAuthBar />
        </View>
      ) : null}
      <MobileBottomNav onHeightChange={setDockHeight} />
      {createOpen && user && (!quota || quota.canCreate) ? (
        <CommunityCreateDialog
          key={user.id}
          userId={user.id}
          onClose={closeCreate}
          onCreated={(slug) => {
            setCreateOpen(false);
            router.push({ params: { slug }, pathname: "/a/[slug]" });
          }}
        />
      ) : null}
      {quota && (gateOpen || (createOpen && !quota.canCreate)) ? (
        <DialogPanel
          title="Founding is earned"
          description=""
          onClose={() => {
            setGateOpen(false);
            closeCreate();
          }}
        >
          <CommunityCreationGate quota={quota} />
        </DialogPanel>
      ) : null}
    </View>
  );
}

function CommunityLoadingState() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.loadingState}>
      <View
        style={[styles.loadingCard, { backgroundColor: theme.dividerLine }]}
      />
      <View
        style={[styles.loadingCard, { backgroundColor: theme.dividerLine }]}
      />
    </View>
  );
}

function CommunityEmptyState({
  activeLabel,
  failed,
  onRetry,
  searching,
}: {
  activeLabel: string;
  failed: boolean;
  onRetry: () => void;
  searching: boolean;
}) {
  const { theme } = useAppTheme();
  const title = searching
    ? "No communities match that search"
    : `Nothing in ${activeLabel} yet`;
  const body = searching
    ? "Nothing here answers to that name. Try a broader word, a topic instead of a title, or look for the people you already follow."
    : "This shelf is waiting on its first community. Make one for the thing you keep coming back to: a game, a language, a city, a weekly ritual. Name it, set the tone, and the regulars find their way in.";
  return (
    <View style={styles.empty}>
      <Image
        contentFit="contain"
        source={noSearchImage}
        style={styles.emptyImage}
      />
      <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
        {failed ? "We couldn’t load the communities right now." : title}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
        {failed ? "Check your connection, then try again." : body}
      </Text>
      {failed ? (
        <SettingsButton
          label="Try again"
          onPress={onRetry}
          radius={8}
          size="sm"
          tone="gray"
        />
      ) : null}
    </View>
  );
}

// eslint-disable-next-line sort-keys
const styles = StyleSheet.create({
  authDock: {
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 60,
  },
  browseCountRow: {
    alignItems: "center",
    flexDirection: "row",
    paddingBottom: 12,
    paddingHorizontal: COMMUNITY_PAGE_GUTTER,
    paddingTop: 0,
  },
  browseHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
    paddingHorizontal: COMMUNITY_PAGE_GUTTER,
    paddingTop: 32,
  },
  browseTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  cardWrap: { paddingBottom: 16, paddingHorizontal: COMMUNITY_PAGE_GUTTER },
  category: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  categoryBar: {
    paddingVertical: 6,
  },
  categoryInactive: {
    borderColor: "transparent",
  },
  categoryCount: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  categoryRow: { gap: 6, paddingHorizontal: COMMUNITY_PAGE_GUTTER },
  categoryText: { fontFamily: "SofiaProMed", fontSize: 14, lineHeight: 20 },
  content: { paddingTop: 0 },
  countLabel: { fontFamily: "SofiaProReg", fontSize: 14 },
  countStrong: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  createButton: {
    alignItems: "center",
    maxWidth: 320,
    width: "100%",
  },
  createButtonSurface: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 40,
    width: "100%",
  },
  createButtonText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 15,
  },
  empty: {
    alignItems: "center",
    gap: 12,
    justifyContent: "flex-start",
    marginHorizontal: COMMUNITY_PAGE_GUTTER,
    paddingHorizontal: 24,
    paddingVertical: 64,
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 19.5,
    maxWidth: 320,
    textAlign: "center",
  },
  emptyImage: { height: 96, width: 96 },
  emptyTitle: { fontFamily: "SofiaProMed", fontSize: 14 },
  footer: { marginVertical: 20 },
  hero: { position: "relative" },
  heroBody: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  heroContent: {
    paddingBottom: 16,
    paddingHorizontal: COMMUNITY_PAGE_GUTTER,
    paddingTop: 32,
  },
  heroHeadline: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  heroStatement: { flexShrink: 1 },
  creationInfo: { paddingTop: 4 },
  heroMark: { height: 36, width: 40 },
  heroTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 30,
    letterSpacing: -0.75,
    lineHeight: 32,
  },
  heroTitleRow: { alignItems: "center", flexDirection: "row", gap: 4.8 },
  createAction: { marginTop: 20, width: "100%" },
  chromeFollow: { flex: 1 },
  wash: { left: 0, position: "absolute", right: 0, top: 0 },
  growingRail: { paddingBottom: 28 },
  refreshLabel: { fontFamily: "SofiaProReg", fontSize: 12, marginLeft: "auto" },
  // The pull shifts this view, so the list needs to be allowed to fill it and
  // the wrapper needs a positioning context for the absolutely-placed loader.
  listShift: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  loadingCard: { borderRadius: 16, height: 280 },
  loadingState: { gap: 16, padding: 32 },
  rail: { paddingTop: 28 },
  root: { flex: 1 },
  search: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  searchBand: { paddingHorizontal: COMMUNITY_PAGE_GUTTER, paddingVertical: 8 },
  searchInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minHeight: 46,
  },
  stat: { gap: 4 },
  statLabel: { alignItems: "center", flexDirection: "row", gap: 6 },
  statLabelText: { fontFamily: "SofiaProMed", fontSize: 12 },
  statValue: {
    fontFamily: "SofiaProBold",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
    lineHeight: 24,
  },
  statsPanel: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 20,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
});
