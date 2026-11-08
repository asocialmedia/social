import {
  communityFeedSearchParams,
  communityPostFilterCount,
  readCommunityFeedSelection,
} from "@asm/db/communities";
import type { CommunityPostFilters as PostFilters } from "@asm/db/communities";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { PanelLeft } from "lucide-react-native";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { FlatList, LayoutChangeEvent, ViewInstance } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { metaChip } from "@/components/surface/recipes";
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
import { formatNumber } from "@/lib/format/format-number";
import { bottomDockPadding } from "@/lib/layout/bottom-dock-layout";
import type { ViewToken } from "@/lib/layout/list-virtualization";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import {
  CommunityApiError,
  fetchCommunityDetail,
  fetchCommunityPosts,
  fetchCommunityPreview,
} from "../lib/communities-api";
import type { CommunityDetail, CommunityPreview } from "../lib/communities-api";
import { resolveCommunityAccentColor } from "../lib/community-accents";
import { communityChatUiEnabled } from "../lib/community-chat-features";
import {
  communityHeaderFrame,
  communityHeaderProgress,
  communityIdentityTransform,
} from "../lib/community-header-identity";
import type { HeaderIdentityGeometry } from "../lib/community-header-identity";
import { createCommunityHeaderPan } from "../lib/community-header-pan";
import {
  communityMediaUrl,
  communityPageCache,
} from "../lib/community-page-cache";
import { canReviewCommunityRequests } from "../lib/community-requests-api";
import {
  communityChatHref,
  rememberCommunityPostsHref,
} from "../lib/community-section-links";
import { activeCommunityStore } from "../state/active-community";
import { useCommunityMembership } from "../state/use-community-membership";
import { CommunityAboutCard } from "./community-about-card";
import { CommunityAvatar } from "./community-avatar";
import { CommunityJoinButton } from "./community-join-button";
import { CommunityJoinRequests } from "./community-join-requests";
import { CommunityMatureGate } from "./community-mature-gate";
import { CommunityNavigationDrawer } from "./community-navigation-drawer";
import { CommunityNotifyButton } from "./community-notify-button";
import {
  CommunityPostFilters,
  CommunityPostFilterSummary,
} from "./community-post-filters";
import { CommunityPrivateLanding } from "./community-private-landing";

const COMMUNITY_VIEWABILITY = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 200,
};

// Compact section bar the header identity docks into, and the identity sizes
// it morphs between (web community-posts-workspace: h-12 bar, the 64px
// avatar collapsing into the 28px slot, the 20px name into 14px, the 14px
// slug into 12px).
const COMPACT_BAR_HEIGHT = 48;
const AVATAR_SOURCE_SIZE = 64;
const AVATAR_TARGET_SIZE = 28;
const NAME_TARGET_SCALE = 14 / 20;
const SLUG_TARGET_SCALE = 12 / 14;

interface MorphGeometry extends HeaderIdentityGeometry {
  sourceHeight: number;
}

function emptyMorphGeometry(targetScale: number): MorphGeometry {
  return {
    sourceHeight: 0,
    sourceWidth: 0,
    sourceX: 0,
    sourceY: 0,
    targetScale,
    targetWidth: 0,
    targetX: 0,
    targetY: 0,
  };
}

// Source/target pairs are measured in window coordinates in the same pass,
// so the scroll-independent deltas are exact; the vertical centering matches
// web use-community-header-identity's target adjustment. Zero-size reads
// (before layout) keep the previous geometry.
function measureMorphGeometry(
  source: ViewInstance | null,
  target: ViewInstance | null,
  targetScale: number,
  geometry: { set: (next: MorphGeometry) => void }
): void {
  if (!source || !target) {
    return;
  }
  source.measureInWindow((sourceX, sourceY, sourceWidth, sourceHeight) => {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return;
    }
    target.measureInWindow((targetX, targetY, targetWidth, targetHeight) => {
      if (targetWidth <= 0 || targetHeight <= 0) {
        return;
      }
      geometry.set({
        sourceHeight,
        sourceWidth,
        sourceX: 0,
        sourceY: 0,
        targetScale,
        targetWidth,
        targetX: targetX - sourceX,
        targetY:
          targetY - sourceY + (targetHeight - sourceHeight * targetScale) / 2,
      });
    });
  });
}

// Web's communityIdentityTransform with RN's center-origin scale compensated
// (translate first, then scale), so the scaled box lands exactly on the
// target slot that web's top-left-origin morph lands on.
function morphBoxStyle(
  geometry: MorphGeometry,
  progress: number
): {
  width?: number;
  overflow: "hidden";
  transform: [
    { translateX: number },
    { translateY: number },
    { scale: number },
  ];
} {
  "worklet";
  const transform = communityIdentityTransform(geometry, progress);
  const clippedWidth = geometry.sourceWidth - transform.clipRight;
  const width = clippedWidth * transform.scale;
  const height = geometry.sourceHeight * transform.scale;
  return {
    overflow: "hidden",
    transform: [
      { translateX: transform.x - (clippedWidth - width) / 2 },
      { translateY: transform.y - (geometry.sourceHeight - height) / 2 },
      { scale: transform.scale },
    ],
    width: clippedWidth || undefined,
  };
}

type CommunitySort = "new" | "top";
export function CommunityDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [dockHeight, setDockHeight] = useState(56);
  const params = useLocalSearchParams<{
    requests?: string | string[];
    slug?: string | string[];
  }>();
  const slug =
    (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  // The join-request notification and push link here with `?requests=1`.
  const requestsLink =
    (Array.isArray(params.requests) ? params.requests[0] : params.requests) ===
    "1";
  const { theme, isDark } = useAppTheme();
  const { user } = useSessionContext();
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  // A PRIVATE community the viewer cannot read: the detail route answers 404,
  // and the public preview drives the members-only landing instead. Stamped
  // with the viewer and slug so a navigation never shows another community's
  // landing.
  const [privatePreview, setPrivatePreview] = useState<{
    preview: CommunityPreview;
    scope: string;
  } | null>(null);
  const [sort, setSort] = useState<CommunitySort>("new");
  const [filters, setFilters] = useState<PostFilters>(() =>
    readCommunityFeedSelection(new URLSearchParams())
  );
  // Filter/sort keystrokes update the picker UI immediately, but the feed
  // query (and its cache key) follows the deferred value, so typing does not
  // reload the whole feed on every keystroke (audit P2-3).
  const deferredFilters = useDeferredValue(filters);
  const deferredSort = useDeferredValue(sort);
  const [revision, setRevision] = useState(0);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [visiblePostIds, setVisiblePostIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const visibleKeyRef = useRef("");
  const handleViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedRow>[] }) => {
      const ids = viewableItems
        .filter((item) => item.isViewable)
        .map((item) => item.item.post.id);
      // Viewability ticks fire on every scroll settle; only publish when the
      // visible set actually changes so autoplay state does not churn (P1-2).
      // oxlint-disable-next-line unicorn/no-array-sort -- Device Hermes predates ES2023 toSorted (TypeError on device); sort runs on a fresh spread copy.
      const key = [...ids].slice().sort().join(",");
      if (key !== visibleKeyRef.current) {
        visibleKeyRef.current = key;
        setVisiblePostIds(new Set(ids));
      }
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
  const cacheKey = `${apiBase}:${user?.id ?? "guest"}:${slug}:${communityFeedSearchParams({ ...deferredFilters, sort: deferredSort })}`;
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
          setPrivatePreview(null);
        }
      } catch (error) {
        // A 404 is also what a PRIVATE community answers a non-member, so ask
        // the preview route before calling the community missing.
        const preview =
          error instanceof CommunityApiError && error.status === 404
            ? await fetchCommunityPreview(slug, {
                apiBase,
                cookie: await authClient.getCookie(),
              }).catch(() => null)
            : null;
        if (!active) {
          return;
        }
        if (preview && !preview.permissions.canReadContent) {
          setPrivatePreview({ preview, scope: `${viewerScope}:${slug}` });
        } else {
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
              deferredSort,
              deferredFilters
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
  }, [apiBase, cacheKey, deferredFilters, deferredSort, revision, slug]);
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
  // Remember this posts view (with its feed filters) as the community's
  // return destination, mirroring web's rememberSection on every posts view.
  // The Chat-side Posts button restores the filtered href via
  // communityPostsHref instead of the bare community root.
  useEffect(() => {
    if (!slug) {
      return;
    }
    const query = communityFeedSearchParams({
      ...deferredFilters,
      sort: deferredSort,
    }).toString();
    rememberCommunityPostsHref(
      user?.id,
      slug,
      `/a/${slug}${query ? `?${query}` : ""}`
    );
  }, [deferredFilters, deferredSort, slug, user?.id]);
  const handleRefresh = () => {
    setRefreshing(true);
    handleRetry();
  };
  const scrollOffset = useSharedValue(0);
  const listRef = useRef<FlatList<FeedRow>>(null);
  const scrollHeader = useCallback((offset: number) => {
    listRef.current?.scrollToOffset({ animated: false, offset });
  }, []);
  const pull = usePullToRefresh({
    failed: feedError || detailError,
    onRefresh: handleRefresh,
    refreshing,
    scrollOffset,
    updatedMessage: "Community updated",
  });
  const headerPan = useMemo(
    () =>
      // oxlint-disable-next-line react/refs -- The factory retains touch callbacks and never invokes them during render.
      createCommunityHeaderPan({
        getOffset: () => scrollOffset.get(),
        refreshGesture: pull.gesture,
        scrollTo: scrollHeader,
      }),
    [pull.gesture, scrollHeader, scrollOffset]
  );
  const reportPullOffset = pull.onScrollOffset;
  const endPull = pull.onScrollEndDrag;
  // Header identity morph state (web community-posts-workspace parity): the
  // avatar, name and slug shrink and slide into the section bar while the
  // action buttons, private chip and member count fade out over the first
  // half. Geometry is measured on layout into shared values and progress
  // derives from the scroll offset, so the morph runs entirely on the UI
  // thread with no per-frame JS setState.
  const avatarSourceRef = useRef<ViewInstance>(null);
  const avatarTargetRef = useRef<ViewInstance>(null);
  const nameSourceRef = useRef<ViewInstance>(null);
  const nameTargetRef = useRef<ViewInstance>(null);
  const slugSourceRef = useRef<ViewInstance>(null);
  const slugTargetRef = useRef<ViewInstance>(null);
  const headerContentHeight = useSharedValue(0);
  const avatarMorph = useSharedValue<MorphGeometry>(
    emptyMorphGeometry(AVATAR_TARGET_SIZE / AVATAR_SOURCE_SIZE)
  );
  const nameMorph = useSharedValue<MorphGeometry>(
    emptyMorphGeometry(NAME_TARGET_SCALE)
  );
  const slugMorph = useSharedValue<MorphGeometry>(
    emptyMorphGeometry(SLUG_TARGET_SCALE)
  );
  const remeasureMorph = useCallback(() => {
    measureMorphGeometry(
      avatarSourceRef.current,
      avatarTargetRef.current,
      AVATAR_TARGET_SIZE / AVATAR_SOURCE_SIZE,
      avatarMorph
    );
    measureMorphGeometry(
      nameSourceRef.current,
      nameTargetRef.current,
      NAME_TARGET_SCALE,
      nameMorph
    );
    measureMorphGeometry(
      slugSourceRef.current,
      slugTargetRef.current,
      SLUG_TARGET_SCALE,
      slugMorph
    );
  }, [avatarMorph, nameMorph, slugMorph]);
  const morphProgress = useDerivedValue(() =>
    communityHeaderProgress(scrollOffset.get(), headerContentHeight.get())
  );
  const headerFrame = useDerivedValue(() =>
    communityHeaderFrame(headerContentHeight.get(), morphProgress.get(), 0)
  );
  const headerLayerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headerFrame.get().layerY }],
  }));
  const headerSpacerStyle = useAnimatedStyle(() => ({
    height: headerFrame.get().spacerHeight,
  }));
  const avatarMorphStyle = useAnimatedStyle(() =>
    morphBoxStyle(avatarMorph.get(), morphProgress.get())
  );
  const nameMorphStyle = useAnimatedStyle(() =>
    morphBoxStyle(nameMorph.get(), morphProgress.get())
  );
  const slugMorphStyle = useAnimatedStyle(() =>
    morphBoxStyle(slugMorph.get(), morphProgress.get())
  );
  const nameContentStyle = useAnimatedStyle(() => ({
    width: nameMorph.get().sourceWidth || undefined,
  }));
  const slugContentStyle = useAnimatedStyle(() => ({
    width: slugMorph.get().sourceWidth || undefined,
  }));
  // Web's detailsOpacity: 1 to 0 over progress 0 to 0.5.
  const detailsFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(morphProgress.get(), [0, 0.5], [1, 0]),
  }));
  // The tabs row's top offset within the header is the height of the content
  // above it, which sets the morph's collapse distance.
  const handleHeaderTabsLayout = useCallback(
    (event: LayoutChangeEvent) => {
      headerContentHeight.set(event.nativeEvent.layout.y);
      remeasureMorph();
    },
    [headerContentHeight, remeasureMorph]
  );
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
  const handleMore = useCallback(async () => {
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
        deferredSort,
        deferredFilters
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
  }, [
    apiBase,
    cacheKey,
    cursor,
    deferredFilters,
    deferredSort,
    feedError,
    loading,
    slug,
  ]);
  const handleEndReached = useCallback(() => {
    void handleMore();
  }, [handleMore]);
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
  // Memoized feed rows (audit P1-1): the inline renderItem, empty and footer
  // used to be recreated every render, re-rendering every mounted card on
  // each keystroke or viewability tick. Defined before the early returns so
  // hook order stays stable across loading/error/ready states.
  const renderPost = useCallback(
    ({ item }: { item: FeedRow }) => (
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
    ),
    [detail?.community.mature, matureAccepted, user?.id, visiblePostIds]
  );
  const listEmpty = useMemo(() => {
    if (loading) {
      return <FeedSkeleton />;
    }
    if (feedError) {
      return (
        <View style={styles.state}>
          <Text style={{ color: theme.inputText }}>Couldn't load posts</Text>
          <StatusActionButton label="Try again" onPress={handleRetry} />
        </View>
      );
    }
    return (
      <View style={styles.state}>
        <Text
          style={{
            color: theme.inputText,
            fontFamily: "SofiaProBold",
            fontSize: 18,
          }}
        >
          {communityPostFilterCount(filters)
            ? "No posts match these filters"
            : "No posts yet"}
        </Text>
        <Text style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}>
          {communityPostFilterCount(filters)
            ? "Try a different combination or clear your filters."
            : "Be the first to post here."}
        </Text>
      </View>
    );
  }, [
    feedError,
    filters,
    handleRetry,
    loading,
    theme.dividerText,
    theme.inputText,
  ]);
  const listFooter = useMemo(
    () => (loadingMore ? <FeedSkeletonCard /> : undefined),
    [loadingMore]
  );
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
  const landingScope = `${user?.id ?? "guest"}:${slug}`;
  if (!detail && privatePreview?.scope === landingScope) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <MobileHeader
          hideOnScroll={false}
          user={headerUser}
          unreadCount={unreadNotifications}
        />
        <CommunityPrivateLanding
          key={landingScope}
          bottomPadding={bottomDockPadding({
            bottomInset: insets.bottom,
            dockHeight,
          })}
          initialPreview={privatePreview.preview}
          isLoggedIn={Boolean(user)}
          onAccessGranted={handleRetry}
          onRequireLogin={handleRequireLogin}
        />
        <MobileBottomNav onHeightChange={setDockHeight} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <MobileHeader
          hideOnScroll={false}
          user={headerUser}
          unreadCount={unreadNotifications}
        />
        <View style={{ backgroundColor: theme.cardBg, height: 144 }} />
        <FeedSkeleton />
      </View>
    );
  }
  const { community } = detail;
  const chip = metaChip(isDark);
  const banner = communityMediaUrl(community.bannerUrl, apiBase);
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        hideOnScroll={false}
        user={headerUser}
        unreadCount={unreadNotifications}
      />
      <GestureDetector gesture={pull.gesture}>
        <View style={styles.listWrap}>
          <Animated.View
            style={[
              styles.root,
              { transform: [{ translateY: pull.pullShift }] },
            ]}
          >
            <GestureDetector gesture={headerPan}>
              <Reanimated.View
                style={[
                  styles.headerLayer,
                  { backgroundColor: theme.containerBg },
                  headerLayerStyle,
                ]}
              >
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
                <View
                  style={{
                    paddingBottom: 16,
                    paddingHorizontal: 16,
                    zIndex: 3,
                  }}
                >
                  <View
                    style={{
                      alignItems: "flex-end",
                      flexDirection: "row",
                      gap: 12,
                      justifyContent: "space-between",
                      marginTop: -32,
                    }}
                  >
                    <Reanimated.View style={avatarMorphStyle}>
                      <View
                        collapsable={false}
                        onLayout={remeasureMorph}
                        ref={avatarSourceRef}
                      >
                        <CommunityAvatar community={community} size={64} />
                      </View>
                    </Reanimated.View>
                    <Reanimated.View
                      style={[
                        {
                          alignItems: "center",
                          flexDirection: "row",
                          gap: 8,
                          paddingBottom: 4,
                        },
                        detailsFadeStyle,
                      ]}
                    >
                      {canReviewCommunityRequests(
                        community.type,
                        membership.membership ?? detail.membership
                      ) ? (
                        <CommunityJoinRequests
                          key={`${user?.id ?? "guest"}:${slug}`}
                          initiallyOpen={requestsLink}
                          onDecided={handleRetry}
                          slug={slug}
                        />
                      ) : null}
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
                    </Reanimated.View>
                  </View>
                  <Reanimated.View style={[{ marginTop: 12 }, nameMorphStyle]}>
                    <Reanimated.View
                      collapsable={false}
                      onLayout={remeasureMorph}
                      ref={nameSourceRef}
                      style={nameContentStyle}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          color: theme.inputText,
                          fontFamily: "SofiaProBold",
                          fontSize: 20,
                        }}
                      >
                        {community.name}
                      </Text>
                    </Reanimated.View>
                  </Reanimated.View>
                  <View style={styles.metaRow}>
                    <Reanimated.View
                      style={[{ flexShrink: 1, minWidth: 0 }, slugMorphStyle]}
                    >
                      <Reanimated.View
                        collapsable={false}
                        onLayout={remeasureMorph}
                        ref={slugSourceRef}
                        style={slugContentStyle}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.metaText,
                            { color: theme.dividerText },
                          ]}
                        >
                          a/{community.slug}
                        </Text>
                      </Reanimated.View>
                    </Reanimated.View>
                    {community.type === "PRIVATE" ? (
                      <Reanimated.View
                        style={[
                          styles.privateChip,
                          {
                            backgroundColor: chip.background,
                            borderColor: chip.border,
                            boxShadow: chip.shadows,
                          },
                          detailsFadeStyle,
                        ]}
                      >
                        <Text
                          style={[
                            styles.privateChipText,
                            { color: theme.inputText },
                          ]}
                        >
                          Private
                        </Text>
                      </Reanimated.View>
                    ) : null}
                    <Reanimated.View style={detailsFadeStyle}>
                      <Text
                        style={[styles.metaText, { color: theme.dividerText }]}
                      >
                        · {formatNumber(detail.stats.members)}{" "}
                        {detail.stats.members === 1 ? "member" : "members"}
                      </Text>
                    </Reanimated.View>
                  </View>
                </View>
                <View
                  onLayout={handleHeaderTabsLayout}
                  style={{
                    alignItems: "center",
                    backgroundColor: theme.containerBg,
                    borderBottomColor: theme.cardBorder,
                    borderBottomWidth: 1,
                    flexDirection: "row",
                    height: COMPACT_BAR_HEIGHT,
                    paddingHorizontal: 12,
                  }}
                >
                  <Pressable
                    accessibilityLabel="Open community sidebar"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: navigationOpen }}
                    onPress={() => setNavigationOpen(true)}
                    style={{
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 48,
                      minWidth: 48,
                    }}
                  >
                    <PanelLeft color={theme.inputText} size={22} />
                  </Pressable>
                  {/* Invisible morph dock (web community-posts-workspace
                          identity): the collapsing avatar, name and slug land
                          here at full collapse. Its flex slot reserves space
                          beside the section tabs, like web mobile. */}
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    style={styles.morphTargets}
                  >
                    <View
                      collapsable={false}
                      onLayout={remeasureMorph}
                      ref={avatarTargetRef}
                      style={styles.morphAvatarTarget}
                    />
                    <View
                      collapsable={false}
                      onLayout={remeasureMorph}
                      ref={nameTargetRef}
                      style={styles.morphNameTarget}
                    >
                      <Text numberOfLines={1} style={styles.morphNameText}>
                        {community.name}
                      </Text>
                    </View>
                    <View
                      collapsable={false}
                      onLayout={remeasureMorph}
                      ref={slugTargetRef}
                      style={styles.morphSlugTarget}
                    >
                      <Text numberOfLines={1} style={styles.morphSlugText}>
                        a/{community.slug}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexShrink: 0 }}>
                    <FeedTabs<"posts" | "chat">
                      alignment="start"
                      active="posts"
                      tabs={[
                        { label: "Posts", value: "posts" },
                        ...(communityChatUiEnabled
                          ? [{ label: "Chat", value: "chat" as const }]
                          : []),
                      ]}
                      onChange={(value) => {
                        if (value === "chat") {
                          router.push(communityChatHref(user?.id, slug));
                        }
                      }}
                    />
                  </View>
                </View>
              </Reanimated.View>
            </GestureDetector>
            <GestureDetector gesture={pull.nativeScrollGesture}>
              <Reanimated.FlatList
                ref={listRef}
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
                    <Reanimated.View style={headerSpacerStyle} />
                    <View
                      style={{
                        alignItems: "center",
                        flexDirection: "row",
                        paddingRight: 12,
                      }}
                    >
                      <View style={{ flex: 1 }}>
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
                      </View>
                      <CommunityPostFilters
                        filters={filters}
                        onChange={setFilters}
                      />
                    </View>
                    <CommunityPostFilterSummary
                      filters={filters}
                      onClear={() =>
                        setFilters(
                          readCommunityFeedSelection(new URLSearchParams())
                        )
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
                ListEmptyComponent={listEmpty ?? undefined}
                ListFooterComponent={listFooter}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.6}
                viewabilityConfig={COMMUNITY_VIEWABILITY}
                onViewableItemsChanged={handleViewable}
                renderItem={renderPost}
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
      {navigationOpen && detail ? (
        <CommunityNavigationDrawer
          key={`${user?.id ?? "guest"}:${slug}`}
          about={
            community.type === "PRIVATE" ? undefined : (
              <CommunityAboutCard detail={detail} />
            )
          }
          active="posts"
          accentColor={detail.community.accentColor}
          communityName={detail.community.name}
          onClose={() => setNavigationOpen(false)}
          slug={slug}
          viewerId={user?.id}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  headerLayer: { left: 0, position: "absolute", right: 0, top: 0, zIndex: 3 },
  listWrap: { flex: 1, overflow: "hidden", position: "relative" },
  metaRow: {
    alignItems: "center",
    columnGap: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 4,
  },
  metaText: { flexShrink: 1, fontFamily: "SofiaProReg", fontSize: 14 },
  // Invisible morph dock in the section bar: the collapsing identity lands
  // here. Its flex slot keeps long names separate from the section tabs.
  morphAvatarTarget: { height: 28, width: 28 },
  morphNameTarget: { flexShrink: 1, minWidth: 0 },
  morphNameText: { fontFamily: "SofiaProBold", fontSize: 14 },
  morphSlugTarget: { flexShrink: 1, minWidth: 0 },
  morphSlugText: { fontFamily: "SofiaProReg", fontSize: 12 },
  morphTargets: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
    opacity: 0,
    overflow: "hidden",
  },
  // Web's `chip-3d px-1.5 text-[10px]`.
  privateChip: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  privateChipText: { fontFamily: "SofiaProMed", fontSize: 10 },
  root: { flex: 1 },
  state: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    padding: 32,
  },
});
