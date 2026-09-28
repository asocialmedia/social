import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  FileText,
  LayoutGrid,
  Plus,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react-native";
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import bannerAsm from "@/assets/images/banner-asm.png";
import noSearchImage from "@/assets/images/nosearch.png";
import zephImage from "@/assets/images/zeph.png";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
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
} from "../lib/communities-api";
import type {
  CommunityCategory,
  CommunityData,
  CommunityPage,
} from "../lib/communities-api";
import { CommunityCard } from "./community-card";
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

function headingFor(
  search: string,
  category: CommunityCategory,
  categoryLabel: string
): string {
  if (search) {
    return `Results for “${search}”`;
  }
  if (category === "all") {
    return "All communities";
  }
  return categoryLabel;
}

export function CommunitiesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ search?: string | string[] }>();
  const { isPending, user } = useSessionContext();
  const insets = useSafeAreaInsets();
  const { isDark, theme } = useAppTheme();
  const mobileHeaderUser = user
    ? { ...user, username: user.username ?? "unknown" }
    : null;
  const initialSearch = Array.isArray(params.search)
    ? params.search[0]
    : params.search;
  const [search, setSearch] = useState(initialSearch ?? "");
  const deferredSearch = useDeferredValue(search.trim());
  const [category, setCategory] = useState<CommunityCategory>("all");
  const [page, setPage] = useState<CommunityPage | null>(null);
  const [communities, setCommunities] = useState<CommunityData[]>([]);
  const [status, setStatus] = useState<"error" | "loading" | "success">(
    "loading"
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dockHeight, setDockHeight] = useState(56);
  const showGuestBar = !isPending && !user;

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
      const cookie = await authClient.getCookie();
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
  }, [category, deferredSearch]);

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
    router.push(user ? "/communities/create" : "/(auth)/login");
  };

  const showRails = !deferredSearch && category === "all";
  const activeLabel =
    COMMUNITY_DISCOVERY_CATEGORIES.find((item) => item.key === category)
      ?.label ?? "All";
  const heading = headingFor(deferredSearch, category, activeLabel);
  const stats = page?.stats ?? { communities: 0, members: 0, posts: 0 };
  const counts = page?.counts ?? {};

  const header = (
    <View>
      <MobileHeader user={mobileHeaderUser} />
      <View
        style={[
          styles.categoryBar,
          {
            backgroundColor: theme.containerBg,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.categoryRow}
          horizontal
          showsHorizontalScrollIndicator={false}
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
                    { color: active ? "#f97316" : theme.dividerText },
                  ]}
                >
                  {count === undefined ? "—" : number(count)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.hero}>
        <Image
          pointerEvents="none"
          source={bannerAsm}
          style={styles.heroWash}
        />
        <View style={styles.heroContent}>
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
          <Text style={[styles.heroBody, { color: theme.dividerText }]}>
            Find a new space to play, chill, and hang out.
          </Text>
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
              radius={10}
              shadows={
                isDark ? LOGIN_BUTTON_SHADOWS : LOGIN_BUTTON_SHADOWS_LIGHT
              }
              style={styles.createButtonSurface}
            >
              <Plus color="#ffffff" size={16} />
              <Text style={styles.createButtonText}>Create community</Text>
            </Gradient3D>
          </Pressable>
          <View
            style={[
              styles.statsPanel,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
              },
            ]}
          >
            <Stat
              icon={<Users color="#f97316" fill="#f97316" size={14} />}
              label="Communities"
              value={stats.communities}
            />
            <Stat
              icon={<UserRound color="#f97316" fill="#f97316" size={14} />}
              label="Members"
              value={stats.members}
            />
            <Stat
              icon={<FileText color="#f97316" fill="#f97316" size={14} />}
              label="Posts"
              value={stats.posts}
            />
          </View>
        </View>
      </View>
      <View style={[styles.searchBand, { backgroundColor: theme.containerBg }]}>
        <View
          style={[
            styles.search,
            {
              backgroundColor: theme.inputBg,
              borderColor: theme.inputBorder,
              boxShadow: isDark
                ? SEARCH_PANEL_SHADOWS_DARK
                : SEARCH_PANEL_SHADOWS,
            },
          ]}
        >
          <Search color={theme.dividerText} size={17} />
          <TextInput
            accessibilityLabel="Search communities"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search communities"
            placeholderTextColor={theme.inputPlaceholder}
            style={[styles.searchInput, { color: theme.inputText }]}
            value={search}
          />
          {search ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              onPress={() => setSearch("")}
            >
              <X color={theme.dividerText} size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {showRails && page?.joined.length ? (
        <View style={styles.rail}>
          <CommunityRail
            auras={page.auras}
            communities={page.joined}
            icon="users"
            onOpen={openCommunity}
            title="Joined communities"
          />
        </View>
      ) : null}
      {showRails && page?.sections.trending.length ? (
        <View style={styles.rail}>
          <CommunityRail
            auras={page.auras}
            communities={page.sections.trending}
            icon="flame"
            onOpen={openCommunity}
            title="Trending communities"
          />
        </View>
      ) : null}
      {showRails && page?.sections.growing.length ? (
        <View style={styles.rail}>
          <CommunityRail
            auras={page.auras}
            communities={page.sections.growing}
            icon="zap"
            onOpen={openCommunity}
            title="Growing fast"
          />
        </View>
      ) : null}
      <View style={styles.browseHeading}>
        <LayoutGrid color="#f97316" fill="#f97316" size={20} />
        <Text style={[styles.browseTitle, { color: theme.inputText }]}>
          {heading}
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
      </View>
    </View>
  );

  const empty: React.ReactNode =
    status === "loading" ? (
      <CommunityLoadingState />
    ) : (
      <CommunityEmptyState
        activeLabel={activeLabel}
        onCreate={handleCreate}
        searching={Boolean(deferredSearch)}
      />
    );

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <GestureDetector gesture={pull.gesture}>
        <View style={styles.listWrap}>
          <Animated.View
            style={[
              styles.listShift,
              { transform: [{ translateY: pull.pullShift }] },
            ]}
          >
            <GestureDetector gesture={pull.nativeScrollGesture}>
              <FlatList
                {...LIST_VIRTUALIZATION_PROPS}
                ListEmptyComponent={empty}
                ListFooterComponent={
                  loadingMore ? (
                    <ActivityIndicator color="#f97316" style={styles.footer} />
                  ) : null
                }
                ListHeaderComponent={header}
                contentContainerStyle={[
                  styles.content,
                  { paddingBottom: showGuestBar ? 176 : 96 },
                ]}
                contentInsetAdjustmentBehavior="automatic"
                data={communities}
                keyExtractor={(community) => community.id}
                onEndReached={loadMore}
                onEndReachedThreshold={0.6}
                onScroll={(event) => pull.onScroll(event)}
                onScrollEndDrag={() => pull.onScrollEndDrag()}
                renderItem={({ item }) => (
                  <View style={styles.cardWrap}>
                    <CommunityCard
                      aura={page?.auras[item.id] ?? 0}
                      community={item}
                      onPress={() => openCommunity(item)}
                    />
                  </View>
                )}
                showsVerticalScrollIndicator={false}
              />
            </GestureDetector>
          </Animated.View>
          {pull.loader}
        </View>
      </GestureDetector>
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
  onCreate,
  searching,
}: {
  activeLabel: string;
  onCreate: () => void;
  searching: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  const title = searching
    ? "No communities match that search"
    : `Nothing in ${activeLabel} yet`;
  const body = searching
    ? "Try a different name or topic, or start the community you were looking for."
    : "Be the first to plant a flag here.";
  return (
    <View
      style={[
        styles.empty,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
        },
      ]}
    >
      <Image
        contentFit="contain"
        source={noSearchImage}
        style={styles.emptyImage}
      />
      <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
        {title}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
        {body}
      </Text>
      {searching ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          style={[styles.emptyCreate, { borderColor: theme.cardBorder }]}
        >
          <Plus color="#f97316" size={16} />
          <Text style={styles.emptyCreateText}>Create community</Text>
        </Pressable>
      )}
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.stat}>
      <View style={styles.statLabel}>
        {icon}
        <Text style={[styles.statLabelText, { color: theme.dividerText }]}>
          {label}
        </Text>
      </View>
      <Text style={[styles.statValue, { color: theme.inputText }]}>
        {number(value)}
      </Text>
    </View>
  );
}

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
    paddingHorizontal: 32,
    paddingTop: 16,
  },
  browseHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 32,
    paddingTop: 33,
  },
  browseTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  cardWrap: { paddingHorizontal: 32 },
  category: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  categoryBar: { borderBottomWidth: 1, paddingVertical: 6 },
  categoryCount: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  categoryRow: { gap: 6, paddingHorizontal: 32 },
  categoryText: { fontFamily: "SofiaProMed", fontSize: 13 },
  content: { paddingTop: 0 },
  countLabel: { fontFamily: "SofiaProReg", fontSize: 12 },
  countStrong: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  createButton: {
    alignItems: "center",
    marginTop: 20,
  },
  createButtonSurface: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 40,
    width: "100%",
  },
  createButtonText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
  },
  empty: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    justifyContent: "flex-start",
    marginHorizontal: 32,
    minHeight: 260,
    paddingHorizontal: 24,
    paddingVertical: 50,
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    maxWidth: 320,
    textAlign: "center",
  },
  emptyCreate: {
    alignItems: "center",
    borderColor: "#f9731680",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  emptyCreateText: {
    color: "#f97316",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  emptyImage: { height: 96, width: 96 },
  emptyTitle: { fontFamily: "SofiaProMed", fontSize: 14 },
  footer: { marginVertical: 20 },
  hero: { minHeight: 270, position: "relative" },
  heroBody: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 310,
  },
  heroContent: { gap: 4, paddingHorizontal: 32, paddingTop: 23 },
  heroMark: { height: 30, width: 38 },
  heroTitle: { fontFamily: "SofiaProBold", fontSize: 30, lineHeight: 32 },
  heroTitleRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  heroWash: {
    height: 360,
    left: 0,
    opacity: 0.2,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
  },
  // The pull shifts this view, so the list needs to be allowed to fill it and
  // the wrapper needs a positioning context for the absolutely-placed loader.
  listShift: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
    position: "relative",
  },
  loadingCard: { borderRadius: 16, height: 280 },
  loadingState: { gap: 16, padding: 32 },
  rail: { paddingTop: 24 },
  root: { flex: 1 },
  search: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 32,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  searchBand: { paddingBottom: 10, paddingTop: 27 },
  searchInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minHeight: 46,
  },
  stat: { gap: 5, minWidth: 72 },
  statLabel: { alignItems: "center", flexDirection: "row", gap: 4 },
  statLabelText: { fontFamily: "SofiaProReg", fontSize: 10 },
  statValue: {
    fontFamily: "SofiaProBold",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
  },
  statsPanel: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 18,
    marginTop: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
