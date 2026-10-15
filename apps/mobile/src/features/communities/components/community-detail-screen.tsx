import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewToken } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  FeedSkeleton,
  FeedSkeletonCard,
} from "@/features/feed/components/feed-skeleton";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreAction,
} from "@/features/feed/components/more-menu";
import { PostCard } from "@/features/feed/components/post-card";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import { usePostOverflow } from "@/features/feed/components/use-post-overflow";
import { flattenFeedRows } from "@/features/feed/lib/feed-rows";
import type { FeedRow } from "@/features/feed/lib/feed-rows";
import { groupPostsIntoThreads } from "@/features/feed/lib/feed-types";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { getApiBaseUrl } from "@/lib/api-env";
import { bottomDockPadding } from "@/lib/bottom-dock-layout";
import { formatNumber } from "@/lib/format-number";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import {
  fetchCommunityDetail,
  fetchCommunityPosts,
} from "../lib/communities-api";
import type { CommunityDetail } from "../lib/communities-api";
import { resolveCommunityAccentColor } from "../lib/community-accents";
import {
  communityMediaUrl,
  communityPageCache,
} from "../lib/community-page-cache";
import { activeCommunityStore } from "../state/active-community";
import { useCommunityMembership } from "../state/use-community-membership";
import { CommunityAvatar } from "./community-avatar";
import { CommunityJoinButton } from "./community-join-button";
import { CommunityMatureGate } from "./community-mature-gate";
import { CommunityNotifyButton } from "./community-notify-button";

const COMMUNITY_VIEWABILITY = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 200,
};

type CommunitySort = "new" | "top";
export function CommunityDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dockHeight, setDockHeight] = useState(56);
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug =
    (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const { theme, isDark } = useAppTheme();
  const { user } = useSessionContext();
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [sort, setSort] = useState<CommunitySort>("new");
  const [revision, setRevision] = useState(0);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [visiblePostIds, setVisiblePostIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const handleViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedRow>[] }) => {
      setVisiblePostIds(
        new Set(
          viewableItems
            .filter((item) => item.isViewable)
            .map((item) => item.item.post.id)
        )
      );
    },
    []
  );
  const rows = useMemo(
    () => flattenFeedRows(groupPostsIntoThreads(posts)),
    [posts]
  );
  const unreadNotifications = useUnreadNotificationCount(
    user?.id ?? null,
    Boolean(user)
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [acceptedSlug, setAcceptedSlug] = useState<string | null>(null);
  const matureAccepted = acceptedSlug === slug;
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const generation = useRef(0);
  const paging = useRef(false);
  const forcedKey = useRef<string | null>(null);
  const apiBase = getApiBaseUrl();
  const cacheKey = `${apiBase}:${user?.id ?? "guest"}:${slug}:${sort}`;
  useEffect(() => {
    if (!user?.id || !slug) {
      return;
    }
    const record = async () => {
      try {
        await fetch(
          `${apiBase}/api/communities/${encodeURIComponent(slug)}/visit`,
          { headers: { cookie: await authClient.getCookie() }, method: "POST" }
        );
      } catch {
        // Visits are best effort; a failure must not hide the community.
      }
    };
    void record();
  }, [apiBase, slug, user?.id]);
  const membership = useCommunityMembership({
    initialMembership: detail?.membership ?? null,
    isLoggedIn: Boolean(user),
    slug,
  });
  const handleRetry = useCallback(() => {
    forcedKey.current = cacheKey;
    setRevision((value) => value + 1);
  }, [cacheKey]);
  // oxlint-disable-next-line react/set-state-in-effect -- reset the external detail read for this route before its transport settles
  useEffect(() => {
    const requestRevision = revision;
    if (requestRevision < 0) {
      return;
    }
    let active = true;
    const viewerScope = user?.id ?? "guest";
    if (!viewerScope) {
      return;
    }
    const load = async () => {
      setDetail((current) =>
        current?.community.slug === slug ? current : null
      );
      setDetailError(false);
      try {
        const options = { apiBase, cookie: await authClient.getCookie() };
        const next = await fetchCommunityDetail(slug, options);
        if (active) {
          setDetail(next);
        }
      } catch {
        if (active) {
          setDetailError(true);
        }
      }
    };
    const timer = setTimeout(() => {
      if (slug) {
        void load();
      } else {
        setDetailError(true);
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [apiBase, slug, user?.id, revision]);
  // oxlint-disable-next-line react/set-state-in-effect -- hydrate the selected external page cache before its request settles
  useEffect(() => {
    if (revision < 0) {
      return;
    }
    generation.current += 1;
    const token = generation.current;
    const load = async () => {
      const cached = communityPageCache.get(cacheKey);
      const forced = forcedKey.current === cacheKey;
      if (forced) {
        forcedKey.current = null;
      }
      if (!forced) {
        setPosts(cached?.posts ?? []);
        setCursor(cached?.nextCursor ?? null);
      }
      setLoading(!cached && !forced);
      setFeedError(false);
      setLoadingMore(false);
      paging.current = false;
      try {
        const page = await communityPageCache.load(
          cacheKey,
          async () =>
            fetchCommunityPosts(
              slug,
              null,
              { apiBase, cookie: await authClient.getCookie() },
              sort
            ),
          forced
        );
        if (generation.current === token) {
          setPosts(page.posts);
          setCursor(page.nextCursor);
        }
      } catch {
        if (generation.current === token) {
          setFeedError(true);
        }
      }
      if (generation.current === token) {
        setLoading(false);
        setRefreshing(false);
      }
    };
    void load();
    return () => {
      if (generation.current === token) {
        generation.current += 1;
      }
    };
  }, [apiBase, cacheKey, revision, slug, sort]);
  useFocusEffect(
    useCallback(() => {
      if (detail) {
        activeCommunityStore.getState().set({
          canPost:
            Boolean(user) &&
            membership.membership?.status === "ACTIVE" &&
            (!detail.community.mature || matureAccepted),
          id: detail.community.id,
          slug,
        });
      }
      return () => activeCommunityStore.getState().clear(slug);
    }, [detail, matureAccepted, membership.membership?.status, slug, user])
  );
  const handleRefresh = () => {
    setRefreshing(true);
    handleRetry();
  };
  const pull = usePullToRefresh({
    failed: feedError || detailError,
    onRefresh: handleRefresh,
    refreshing,
    updatedMessage: "Community updated",
  });
  const scrollOffset = useSharedValue(0);
  const reportPullOffset = pull.onScrollOffset;
  const endPull = pull.onScrollEndDrag;
  const handleScroll = useAnimatedScrollHandler({
    onEndDrag: () => scheduleOnRN(endPull),
    onScroll: (event) => {
      const offset = event.contentOffset.y;
      const previous = scrollOffset.get();
      scrollOffset.set(offset);
      if (offset <= 0 || previous <= 0) {
        scheduleOnRN(reportPullOffset, offset);
      }
    },
  });
  const handleMore = async () => {
    if (!cursor || paging.current || loading || feedError) {
      return;
    }
    const token = generation.current;
    paging.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchCommunityPosts(
        slug,
        cursor,
        { apiBase, cookie: await authClient.getCookie() },
        sort
      );
      if (generation.current === token) {
        const next = communityPageCache.append(cacheKey, page);
        setPosts(next.posts);
        setCursor(next.nextCursor);
      }
    } catch {
      if (generation.current === token) {
        setFeedError(true);
      }
    }
    if (generation.current === token) {
      paging.current = false;
      setLoadingMore(false);
    }
  };
  const overflow = usePostOverflow({
    onDeleted: (id) => {
      communityPageCache.removePost(id);
      setPosts((current) => current.filter((post) => post.id !== id));
    },
    onHide: (post) => {
      communityPageCache.removePost(post.id);
      setPosts((current) => current.filter((entry) => entry.id !== post.id));
    },
    onModerated: handleRetry,
    onTagsSaved: handleRetry,
    viewerId: user?.id ?? null,
  });
  const handleAction = (action: MoreAction) => {
    if (menuPost) {
      overflow.onAction(action, menuPost);
    }
    setMenuPost(null);
    setMenuAnchor(null);
  };
  const handleRequireLogin = () => router.push("/(auth)/login");
  const headerUser = user
    ? {
        avatarUrl: user.image ?? null,
        id: user.id,
        username: user.username ?? "",
      }
    : null;
  if (detailError) {
    return (
      <View
        style={[
          styles.root,
          styles.state,
          { backgroundColor: theme.containerBg },
        ]}
      >
        <Text
          style={{
            color: theme.inputText,
            fontFamily: "SofiaProBold",
            fontSize: 18,
          }}
        >
          Couldn't load this community
        </Text>
        <StatusActionButton label="Try again" onPress={handleRetry} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <MobileHeader user={headerUser} unreadCount={unreadNotifications} />
        <View style={{ backgroundColor: theme.cardBg, height: 144 }} />
        <FeedSkeleton />
      </View>
    );
  }
  const { community } = detail;
  const banner = communityMediaUrl(community.bannerUrl, apiBase);
  let empty = (
    <View style={styles.state}>
      <Text
        style={{
          color: theme.inputText,
          fontFamily: "SofiaProBold",
          fontSize: 18,
        }}
      >
        No posts yet
      </Text>
      <Text style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}>
        Be the first to post here.
      </Text>
    </View>
  );
  if (loading) {
    empty = <FeedSkeleton />;
  } else if (feedError) {
    empty = (
      <View style={styles.state}>
        <Text style={{ color: theme.inputText }}>Couldn't load posts</Text>
        <StatusActionButton label="Try again" onPress={handleRetry} />
      </View>
    );
  }
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader user={headerUser} unreadCount={unreadNotifications} />
      <GestureDetector gesture={pull.gesture}>
        <View style={styles.listWrap}>
          <Animated.View
            style={[
              styles.root,
              { transform: [{ translateY: pull.pullShift }] },
            ]}
          >
            <GestureDetector gesture={pull.nativeScrollGesture}>
              <Reanimated.FlatList
                {...LIST_VIRTUALIZATION_PROPS}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  flexGrow: posts.length ? 0 : 1,
                  paddingBottom: bottomDockPadding({
                    bottomInset: insets.bottom,
                    dockHeight,
                  }),
                }}
                data={rows}
                keyExtractor={(row) => row.post.id}
                ListHeaderComponent={
                  <>
                    <View
                      style={{
                        backgroundColor: `${resolveCommunityAccentColor(community.accentColor, isDark)}38`,
                        height: 144,
                        overflow: "hidden",
                      }}
                    >
                      {banner ? (
                        <Image
                          source={{ uri: banner }}
                          contentFit="cover"
                          style={StyleSheet.absoluteFill}
                        />
                      ) : null}
                      <LinearGradient
                        colors={["transparent", theme.containerBg]}
                        style={{
                          bottom: 0,
                          height: 64,
                          left: 0,
                          position: "absolute",
                          right: 0,
                        }}
                      />
                    </View>
                    <View style={{ paddingBottom: 16, paddingHorizontal: 16 }}>
                      <View
                        style={{
                          alignItems: "flex-end",
                          flexDirection: "row",
                          gap: 12,
                          justifyContent: "space-between",
                          marginTop: -32,
                        }}
                      >
                        <CommunityAvatar community={community} size={64} />
                        <View
                          style={{
                            alignItems: "center",
                            flexDirection: "row",
                            gap: 8,
                            paddingBottom: 4,
                          }}
                        >
                          <CommunityJoinButton
                            isLoggedIn={Boolean(user)}
                            membershipState={membership}
                            onRequireLogin={handleRequireLogin}
                          />
                          <CommunityNotifyButton
                            isLoggedIn={Boolean(user)}
                            membershipState={membership}
                            onRequireLogin={handleRequireLogin}
                          />
                        </View>
                      </View>
                      <Text
                        style={{
                          color: theme.inputText,
                          fontFamily: "SofiaProBold",
                          fontSize: 20,
                          marginTop: 12,
                        }}
                      >
                        {community.name}
                      </Text>
                      <Text
                        style={{
                          color: theme.dividerText,
                          fontFamily: "SofiaProReg",
                          fontSize: 14,
                        }}
                      >
                        a/{community.slug} ·{" "}
                        {formatNumber(detail.stats.members)}{" "}
                        {detail.stats.members === 1 ? "member" : "members"}
                      </Text>
                    </View>
                    <FeedTabs
                      alignment="start"
                      active={sort}
                      tabs={[
                        { label: "New", value: "new" },
                        { label: "Top", value: "top" },
                      ]}
                      onChange={(value) =>
                        setSort(value === "top" ? "top" : "new")
                      }
                    />
                    {feedError && posts.length > 0 ? (
                      <Pressable onPress={handleRefresh}>
                        <Text style={{ color: theme.dividerText, padding: 12 }}>
                          Couldn't load more posts. Tap to retry.
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                }
                ListEmptyComponent={empty}
                ListFooterComponent={loadingMore ? <FeedSkeletonCard /> : null}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onEndReached={() => {
                  void handleMore();
                }}
                onEndReachedThreshold={0.6}
                viewabilityConfig={COMMUNITY_VIEWABILITY}
                onViewableItemsChanged={handleViewable}
                renderItem={({ item }) => (
                  <PostCard
                    active={
                      visiblePostIds.has(item.post.id) &&
                      (!detail?.community.mature || matureAccepted)
                    }
                    hasThreadChild={item.hasThreadChild}
                    hasThreadParent={item.hasThreadParent}
                    showCommunity={false}
                    post={item.post}
                    viewerId={user?.id}
                    onMore={(post, anchor) => {
                      setMenuPost(post);
                      setMenuAnchor(anchor);
                    }}
                    onShare={setSharePost}
                  />
                )}
                showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
              />
            </GestureDetector>
          </Animated.View>
          {pull.loader}
        </View>
      </GestureDetector>
      <MobileBottomNav onHeightChange={setDockHeight} />
      <MoreMenu
        anchor={menuAnchor}
        entries={
          menuPost
            ? overflow.entriesFor(menuPost, {
                showCaptions: false,
                showingAlt: false,
              })
            : []
        }
        onAction={handleAction}
        onClose={() => {
          setMenuPost(null);
          setMenuAnchor(null);
        }}
      />
      <ShareSheet post={sharePost} onClose={() => setSharePost(null)} />
      {overflow.dialogs}
      {community.mature && !matureAccepted ? (
        <CommunityMatureGate
          community={community}
          onEnter={() => setAcceptedSlug(slug)}
          onLeave={() => router.back()}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  listWrap: { flex: 1, position: "relative" },
  root: { flex: 1 },
  state: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    padding: 32,
  },
});
