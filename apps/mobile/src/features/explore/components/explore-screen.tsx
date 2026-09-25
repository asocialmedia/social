import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronRight,
  Clapperboard,
  Eye,
  Flame,
  Plus,
  Search,
  X,
} from "lucide-react-native";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import noFollowImage from "@/assets/images/nofollow.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import type { FeedTabDef } from "@/features/feed/components/feed-tabs";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { mediaGridImageUrl } from "@/features/feed/lib/media-url";
import {
  EXPLORE_TABS,
  resolveExploreTab,
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
import {
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  SEARCH_PANEL_SHADOWS,
  SEARCH_PANEL_SHADOWS_DARK,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import {
  ExploreApiError,
  fetchExplorePage,
  fetchExplorePeople,
  fetchExploreTopGusts,
  mutateExploreFollow,
} from "../lib/explore-api";
import type { ExploreCommunityResult, ExploreUser } from "../lib/explore-api";
import { ExplorePostCard } from "./explore-post-card";
import { ExploreUserCard } from "./explore-user-card";

const TAB_DEFS: readonly FeedTabDef<ExploreTab>[] = [
  { label: "For you", value: "for-you" },
  { label: "Gusts", value: "gusts" },
  { label: "People", value: "people" },
  { label: "Trending", value: "trending" },
];

type ExploreItem =
  | { kind: "post"; post: FeedPost }
  | { kind: "user"; user: ExploreUser };

export function ExploreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const { isPending, user } = useSessionContext();
  const insets = useSafeAreaInsets();
  const viewerId = user?.id;
  const [dockHeight, setDockHeight] = useState(56);
  const { runWithInstallToken } = useInstall();
  const { isDark, theme } = useAppTheme();
  const mobileHeaderUser = user
    ? { ...user, username: user.username ?? "unknown" }
    : null;
  const showGuestBar = !isPending && !user;
  const memoryReady = useHomeTabMemoryReady();
  const storedExplore = useTabStore((state) => state.explore);
  const setExploreTab = useTabStore((state) => state.setExploreTab);
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const activeTab = resolveExploreTab(
    tabParam ?? null,
    Boolean(user),
    storedExplore,
    memoryReady
  );
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [users, setUsers] = useState<ExploreUser[]>([]);
  const [communities, setCommunities] = useState<ExploreCommunityResult[]>([]);
  const [gusts, setGusts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"error" | "loading" | "success">(
    "loading"
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!viewerId && activeTab === "for-you") {
        return;
      }
      const cookie = await authClient.getCookie();
      const options = { apiBase: getApiBaseUrl(), cookie };
      const [page, topGusts] = await Promise.all([
        activeTab === "people"
          ? fetchExplorePeople(deferredSearch, Boolean(viewerId), options)
          : fetchExplorePage(activeTab, deferredSearch, cursor, options),
        !append && (activeTab === "for-you" || activeTab === "trending")
          ? fetchExploreTopGusts(options)
          : Promise.resolve([]),
      ]);
      setPosts((current) =>
        append
          ? [
              ...current,
              ...page.posts.filter(
                (post) => !current.some((item) => item.id === post.id)
              ),
            ]
          : page.posts
      );
      setUsers((current) =>
        append
          ? [
              ...current,
              ...page.users.filter(
                (candidate) => !current.some((item) => item.id === candidate.id)
              ),
            ]
          : page.users
      );
      setCommunities(page.communities);
      setGusts(topGusts);
      setNextCursor(page.nextCursor);
      setStatus("success");
    },
    [activeTab, deferredSearch, viewerId]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const cookie = await authClient.getCookie();
      if (!active) {
        return;
      }
      setStatus("loading");
      if (!viewerId && activeTab === "for-you") {
        setStatus("success");
        return;
      }
      setPosts([]);
      setUsers([]);
      setCommunities([]);
      setGusts([]);
      setNextCursor(null);
      try {
        const options = { apiBase: getApiBaseUrl(), cookie };
        const [page, topGusts] = await Promise.all([
          activeTab === "people"
            ? fetchExplorePeople(deferredSearch, Boolean(viewerId), options)
            : fetchExplorePage(activeTab, deferredSearch, null, options),
          activeTab === "for-you" || activeTab === "trending"
            ? fetchExploreTopGusts(options)
            : Promise.resolve([]),
        ]);
        if (!active) {
          return;
        }
        setPosts(page.posts);
        setUsers(page.users);
        setCommunities(page.communities);
        setGusts(topGusts);
        setNextCursor(page.nextCursor);
        setStatus("success");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [activeTab, deferredSearch, viewerId]);

  const selectTab = useCallback(
    (next: ExploreTab) => {
      if (!EXPLORE_TABS.has(next) || next === activeTab) {
        return;
      }
      setExploreTab(next);
      router.setParams({ tab: next });
    },
    [activeTab, router, setExploreTab]
  );

  const handleFollow = useCallback(
    async (userId: string, next: boolean) => {
      if (!viewerId) {
        router.push("/(auth)/login");
        return;
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
        return;
      }
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === userId
            ? {
                ...candidate,
                _count: { ...candidate._count, followers: result.followers },
                isFollowing: result.isFollowedByUser,
              }
            : candidate
        )
      );
    },
    [router, runWithInstallToken, viewerId]
  );

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

  const handleCreateGust = () => {
    router.push(
      viewerId
        ? { params: { create: "true" }, pathname: "/gusts" }
        : "/(auth)/login"
    );
  };

  const fetchMore = async () => {
    if (loadingMore || !nextCursor || activeTab === "people") {
      return;
    }
    setLoadingMore(true);
    try {
      await load(nextCursor, true);
    } catch {
      setStatus("error");
      setLoadingMore(false);
      return;
    }
    setLoadingMore(false);
  };

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

  const renderItem = useCallback(
    ({ item, index }: { index: number; item: ExploreItem }) => {
      if (activeTab === "gusts") {
        if (item.kind !== "post") {
          return null;
        }
        return (
          <ExploreGustTile
            onPress={() =>
              router.push({
                params: { postId: item.post.id },
                pathname: "/posts/[postId]",
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
            viewerLoggedIn={Boolean(viewerId)}
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

  const header = (
    <View>
      <MobileHeader user={mobileHeaderUser} />
      <FeedTabs active={activeTab} onChange={selectTab} tabs={TAB_DEFS} />
      {activeTab === "people" ? (
        <ExplorePeopleHeader
          loggedIn={Boolean(viewerId)}
          onRefresh={refresh}
          onSearch={setSearch}
          search={search}
        />
      ) : null}
      {deferredSearch && communities.length > 0 ? (
        <View style={styles.communityMatches}>
          <Text style={[styles.sectionLabel, { color: theme.dividerText }]}>
            Communities
          </Text>
          <ScrollView
            contentContainerStyle={styles.matchRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {communities.map((community) => (
              <Pressable
                accessibilityLabel={`Open community ${community.name}`}
                accessibilityRole="button"
                key={community.id}
                onPress={() =>
                  router.push({
                    params: { slug: community.slug },
                    pathname: "/a/[slug]",
                  })
                }
                style={[
                  styles.match,
                  {
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                    boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
                  },
                ]}
              >
                <CommunityAvatar community={community} size={36} />
                <View style={styles.matchCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.matchName, { color: theme.inputText }]}
                  >
                    {community.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.matchSlug, { color: theme.dividerText }]}
                  >
                    a/{community.slug}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {gusts.length > 0 && activeTab !== "gusts" && activeTab !== "people" ? (
        <View
          style={[
            styles.gustRail,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <View style={styles.railHeading}>
            <View style={styles.railTitleGroup}>
              <View style={styles.railTitleRow}>
                <Clapperboard color="#f97316" size={16} />
                <Text style={[styles.sectionTitle, { color: theme.inputText }]}>
                  Trending Gusts
                </Text>
              </View>
              <Text style={[styles.railSubtitle, { color: theme.dividerText }]}>
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
          >
            {gusts.map((post) => (
              <ExploreGustTile
                key={post.id}
                onPress={() =>
                  router.push({
                    params: { postId: post.id },
                    pathname: "/posts/[postId]",
                  })
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
  if (status === "loading") {
    empty = <ExploreLoadingState />;
  } else if (status === "error") {
    const message = errorMessageFor(activeTab);
    empty = (
      <View style={styles.errorState}>
        <Text style={[styles.errorText, { color: theme.errorBannerText }]}>
          {message}
        </Text>
      </View>
    );
  } else if (activeTab === "for-you" && !viewerId) {
    empty = <ExploreAuthPrompt onLogin={() => router.push("/(auth)/login")} />;
  } else if (items.length === 0) {
    empty = (
      <ExploreEmptyState
        activeTab={activeTab}
        onCreate={handleCreateGust}
        search={deferredSearch}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <FlatList
        ListEmptyComponent={empty}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: showGuestBar ? 176 : 96 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={(item) =>
          `${item.kind}-${item.kind === "post" ? item.post.id : item.user.id}`
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color="#f97316" style={styles.footerLoader} />
          ) : null
        }
        numColumns={activeTab === "people" ? 1 : 2}
        onEndReached={fetchMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            onRefresh={refresh}
            refreshing={refreshing}
            tintColor="#f97316"
          />
        }
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
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

function ExploreGustTile({
  onPress,
  post,
}: {
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
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <Image
        contentFit="cover"
        source={{ uri: imageUrl }}
        style={styles.gustImage}
      />
      <View style={styles.gustBadge}>
        <Clapperboard color="#f97316" size={11} />
        <Text style={styles.gustBadgeText}>Gust</Text>
      </View>
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

function ExploreLoadingState() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.loadingState}>
      <View
        style={[styles.loadingTile, { backgroundColor: theme.dividerLine }]}
      />
      <View
        style={[styles.loadingTile, { backgroundColor: theme.dividerLine }]}
      />
      <View
        style={[styles.loadingTile, { backgroundColor: theme.dividerLine }]}
      />
      <View
        style={[styles.loadingTile, { backgroundColor: theme.dividerLine }]}
      />
    </View>
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
  onSearch,
  search,
}: {
  loggedIn: boolean;
  onRefresh: () => void;
  onSearch: (value: string) => void;
  search: string;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View style={styles.peopleHeader}>
      <View
        style={[
          styles.peopleSearch,
          {
            backgroundColor: theme.inputBg,
            borderColor: theme.inputBorder,
            boxShadow: isDark
              ? SEARCH_PANEL_SHADOWS_DARK
              : SEARCH_PANEL_SHADOWS,
          },
        ]}
      >
        <Search color={theme.dividerText} size={16} />
        <TextInput
          accessibilityLabel="Search people"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onSearch}
          placeholder="Search people by name or @username"
          placeholderTextColor={theme.inputPlaceholder}
          style={[styles.peopleSearchInput, { color: theme.inputText }]}
          value={search}
        />
        {search ? (
          <Pressable
            accessibilityLabel="Clear people search"
            onPress={() => onSearch("")}
          >
            <X color={theme.dividerText} size={16} />
          </Pressable>
        ) : null}
      </View>
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
  columns: { gap: 16, paddingHorizontal: 16 },
  communityMatches: { gap: 8, paddingTop: 12 },
  content: { paddingTop: 0 },
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
  footerLoader: { marginVertical: 20 },
  gustAuthorCopy: { flex: 1, minWidth: 0 },
  gustAuthorName: {
    color: "#ffffff",
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 10,
  },
  gustAuthorNameRow: { alignItems: "center", flexDirection: "row", gap: 3 },
  gustAuthorRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  gustBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: "absolute",
    top: 8,
  },
  gustBadgeText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 10 },
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
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    marginBottom: 24,
    marginHorizontal: 16,
    marginTop: 16,
    overflow: "hidden",
    paddingBottom: 4,
    paddingTop: 14,
  },
  gustRow: { gap: 12, paddingHorizontal: 16 },
  gustTile: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
    width: 144,
  },
  gustUsername: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: "SofiaProReg",
    fontSize: 9,
    marginTop: 1,
  },
  loadingState: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    padding: 16,
  },
  loadingTile: { aspectRatio: 4 / 5, borderRadius: 16, width: "47%" },
  match: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 224,
  },
  matchCopy: { flex: 1, minWidth: 0 },
  matchName: { fontFamily: "SofiaProMed", fontSize: 13 },
  matchRow: { gap: 8, paddingHorizontal: 16 },
  matchSlug: { fontFamily: "SofiaProReg", fontSize: 11 },
  peopleHeader: { gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  peopleHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  peopleHeadingText: { fontFamily: "SofiaProMed", fontSize: 14 },
  peopleSearch: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  peopleSearchInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 13,
    minHeight: 38,
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
  retry: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 13 },
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
