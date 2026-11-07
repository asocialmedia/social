import {
  activeNetworkInterests,
  discoveryMode,
  feedAvailability,
  filterExternalRecommendations,
  externalNetworkPostAllowed,
  externalNetworkPostRecommended,
  networkPostAllowed,
  networkPostRecommended,
} from "@asm/protocols/discovery";
// One tab's feed list: thread-grouped post cards in a FlatList with
// pull-refresh, infinite scroll, per-tab scroll memory (restores position
// when switching tabs, like web's useFeedScrollMemory), the new-content
// pill overlay, and loading/error/empty/end states mirroring web HomeFeed.
import { Image } from "expo-image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FlatList } from "react-native";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import noFeedImage from "@/assets/images/nofeed.png";
import notFoundImage from "@/assets/images/notfound.png";
import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedErrorState } from "@/features/feed/components/feed-error-state";
import {
  DEFAULT_SOURCE_WAIT_MS,
  FOLLOWING_INITIAL_SOURCE_WAIT_MS,
  useBoundedSourcePending,
} from "@/features/feed/state/use-bounded-source-pending";
import { useFeedExposures } from "@/features/network/state/feed-exposures";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { haptic } from "@/lib/interaction/haptics";
import type { ViewToken } from "@/lib/layout/list-virtualization";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { externalPostView } from "../lib/external-post-view";
import type { FeedVariant } from "../lib/feed-api";
import { feedPrefetchUrls } from "../lib/feed-prefetch";
import { incomingFeedRows } from "../lib/feed-rows";
import { orderByIndex } from "../lib/feed-types";
import type { FeedPost } from "../lib/feed-types";
import {
  HEADER_BAR_HEIGHT,
  advanceHeaderScroll,
  setHeaderHidden,
  resetHeaderScroll,
} from "../lib/header-visibility";
import { hasVideoAttachment } from "../lib/media-kind";
import { mixedFeedRows, nativePostForRow } from "../lib/mixed-feed-rows";
import type { TimelineRow } from "../lib/mixed-feed-rows";
import { viewBatcher } from "../lib/view-batcher";
import {
  setAutoplayPostId,
  setVisiblePostIds,
  setFeedMediaActive,
} from "../lib/visible-posts";
import {
  useFeedSourceStore,
  useExternalExclusions,
} from "../state/feed-source-store";
import {
  consumeFeedTop,
  feedCache,
  subscribeFeedTopRequests,
} from "../state/feed-store";
import { useBlueskyFeed } from "../state/use-bluesky-feed";
import { useFeedTab } from "../state/use-feed";
import { useFeedImpressions } from "../state/use-feed-impressions";
import { useVideoCaptionsStore } from "../state/video-captions-store";
import { BlueskyPostCard } from "./bluesky-post-card";
import { FeedSkeleton, FeedSkeletonCard } from "./feed-skeleton";
import { buildMoreEntries, MoreMenu } from "./more-menu";
import type { MenuAnchor, MoreAction } from "./more-menu";
import { NewContentPill } from "./new-content-pill";
import type { PillAuthor } from "./new-content-pill";
import { PostCard } from "./post-card";
import { FeedMediaScope } from "./post-media";
import { ShareSheet } from "./share-sheet";
import { usePostOverflow } from "./use-post-overflow";

// All lists reconcile through the same handler, whose lifetime is the batcher,
// so unmounting a neighbouring tab cannot remove another tab's reconciliation.
viewBatcher.onFlush = (counts) => {
  feedCache.updatePostsEverywhere(
    new Map(
      Object.entries(counts).map(([postId, viewCount]) => [
        postId,
        { viewCount },
      ])
    )
  );
};

// Scroll offsets survive tab switches (and unmounts) like web's
// useFeedScrollMemory with memoryKey `home:${tab}`.
const scrollMemory = new Map<string, number>();
// Stable across renders so the list never re-subscribes viewability on every
// tick. minimumViewTime avoids flapping during fast flings.
const STABLE_VIEWABILITY = {
  minimumViewTime: 300,
  viewAreaCoveragePercentThreshold: 50,
};
function feedRowKey(row: TimelineRow): string {
  return row.id;
}

// Guest prompt copy (web client-home AuthPromptCard) and empty-feed copy
// (web home-feed / following). Following's empty state is one line on web.
const GUEST_FOLLOWING_DESCRIPTION =
  "Follow people you love and their fleets will land right here.";

const EMPTY_COPY: Record<FeedVariant, { description: string; title: string }> =
  {
    following: {
      description: "",
      title:
        "No Fleets found. Start following people to see their Fleets here!",
    },
    latest: {
      description: "The latest Fleets will appear here.",
      title: "No Fleets yet.",
    },
    personalized: {
      description:
        "Your feed will learn from what you read, amplify, bookmark, and discuss.",
      title: "No personalized Fleets to show here.",
    },
    trending: {
      description: "Posts with the most aura will surface here.",
      title: "No trending fleets yet.",
    },
  };

// Web's manual "Load more posts" premium button, offered after a source fails.
function LoadMoreButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.loadMore}>
      <Pressable
        accessibilityLabel="Load more posts"
        accessibilityRole="button"
        onPress={() => {
          haptic();
          onPress();
        }}
      >
        {({ pressed }) => (
          <Gradient3D
            colors={pressed ? ORANGE_PRESSED_GRADIENT : ORANGE_GRADIENT}
            radius={9999}
            shadows={ORANGE_BUTTON_SHADOWS}
            style={[styles.loadMorePill, pressed && styles.loadMorePressed]}
          >
            <Text style={styles.loadMoreText}>Load more posts</Text>
          </Gradient3D>
        )}
      </Pressable>
    </View>
  );
}

// The non-list states (loading skeleton, error, empty) fill the space the
// list would. The child keeps the flex it needs to fill the remaining space.
function FeedState({ children }: { children: ReactNode }) {
  return <View style={styles.stateWrap}>{children}</View>;
}

interface FeedListProps {
  // Whether this tab is the visible one. Data fetching uses `enabled`
  // (neighbours preload in the background); video autoplay, viewability
  // publishing and header signals use `active` (visible only). Defaults to
  // `enabled` so single-list surfaces keep working unchanged.
  active?: boolean;
  // Extra tail padding when an overlay (guest banner + floating dock) sits
  // over the feed's end, so the last post scrolls clear of it. End padding
  // never moves visible items, so it can jump with overlay visibility.
  bottomInset?: number;
  enabled: boolean;
  // Every page reserves the same space for the persistent editor above the pager.
  headerHeight?: number;
  headerScrollOffset?: SharedValue<number>;
  userId: string | undefined;
  variant: FeedVariant;
}

export const FeedList = memo(
  ({
    active,
    bottomInset = 0,
    enabled,
    headerHeight = 0,
    headerScrollOffset,
    userId,
    variant,
  }: FeedListProps) => {
    const isActive = active ?? enabled;
    const { theme } = useAppTheme();
    const { user } = useSessionContext();
    const network = useNetworkSettings();
    const selectedSource = useFeedSourceStore((state) => state.source);
    const source = selectedSource;
    const excluded = useExternalExclusions(userId ?? "guest");
    const includeBluesky = source !== "asm";

    const external = useBlueskyFeed(
      discoveryMode(variant),
      enabled && includeBluesky && (variant !== "following" || Boolean(userId)),
      userId,
      variant === "following"
    );
    const externalPosts = useMemo(
      () =>
        filterExternalRecommendations(
          external.pages
            .flatMap((page) => page.items)
            .filter(
              (post) =>
                network.ready &&
                (variant === "following"
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
                    ))
            ),
          excluded
        ),
      [
        external.pages,
        excluded,
        network.ready,
        network.settings.preferences,
        network.settings.topicScope,
        variant,
      ]
    );
    const listRef = useRef<FlatList<TimelineRow>>(null);
    const previousSource = useRef(source);
    useEffect(() => {
      if (previousSource.current !== source) {
        previousSource.current = source;
        listRef.current?.scrollToOffset({ animated: false, offset: 0 });
      }
    }, [source]);
    const scrollOffset = useSharedValue(
      // Same key the scroll handlers write (memoryKey below); the old read
      // added scope and locale, so the seed never hit.
      scrollMemory.get(`home:${variant}:${userId ?? "guest"}`) ?? 0
    );
    const scrollActive = useSharedValue(false);
    const userScrolling = useSharedValue(false);
    const scrollVisibility = useSharedValue({ baseline: 0, hidden: false });

    // Latest viewable ids are retained so the tab can publish them when it
    // becomes active; the FlatList retains the first closure, so activity is
    // read through a ref.
    const enabledRef = useRef(isActive);
    const latestVisibleRef = useRef<ReadonlySet<string>>(new Set());
    // The autoplay owner the last viewability pass nominated, retained for the
    // same reason as the ids: switching back to this tab restores playback
    // without waiting for a scroll event that may never come.
    const latestAutoplayRef = useRef<string | null>(null);
    const [sharePost, setSharePost] = useState<FeedPost | null>(null);
    const [moreTarget, setMoreTarget] = useState<{
      anchor: MenuAnchor;
      post: FeedPost;
    } | null>(null);
    const showCaptions = useVideoCaptionsStore((state) => state.showCaptions);
    const toggleCaptions = useVideoCaptionsStore(
      (state) => state.toggleCaptions
    );
    const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
      () => new Set()
    );
    const {
      clearNewItems,
      incomingIds,
      dismissPost,
      fetchNext,
      hasMore,
      newItems,
      posts: unfilteredPosts,
      refresh,
      showNewPosts,
      status,
      undoDismiss,
    } = useFeedTab({ active: isActive, enabled, userId, variant });

    const posts = useMemo(
      () =>
        unfilteredPosts.filter(
          (post) =>
            network.ready &&
            (variant === "following"
              ? networkPostAllowed(
                  post,
                  network.settings.preferences,
                  network.settings.topicScope
                )
              : networkPostRecommended(
                  post,
                  network.settings.preferences,
                  network.settings.topicScope
                ))
        ),
      [
        unfilteredPosts,
        network.ready,
        network.settings.preferences,
        network.settings.topicScope,
        variant,
      ]
    );
    const impressionPosts = useMemo(
      () => [...posts, ...externalPosts.map(externalPostView)],
      [posts, externalPosts]
    );
    useFeedImpressions(impressionPosts, latestVisibleRef, isActive, user?.id);

    const overflow = usePostOverflow({
      onDeleted: (postId) => {
        // A deleted post leaves the feed the same way a hidden one does, but
        // with no undo: there is nothing left to bring back.
        dismissPost(postId);
      },
      onHide: (post) => {
        dismissPost(post.id);
      },
      onModerated: (postId, next) => {
        feedCache.updatePostEverywhere(postId, next);
      },
      onTagsSaved: (postId, tags) => {
        feedCache.updatePostEverywhere(postId, {
          tags: tags.map((name) => ({ id: name, name })),
        });
      },
      onToggleAlt: (post) => {
        setAltVisibleIds((current) => {
          const next = new Set(current);
          if (next.has(post.id)) {
            next.delete(post.id);
          } else {
            next.add(post.id);
          }
          return next;
        });
      },
      onToggleCaptions: () => {
        toggleCaptions();
      },
      onUndoHide: (post) => {
        undoDismiss(post.id);
      },
      viewerId: user?.id ?? null,
    });

    const handleMoreAction = useCallback(
      (action: MoreAction) => {
        const morePost = moreTarget?.post;
        if (!morePost) {
          return;
        }
        overflow.onAction(action, morePost);
      },
      [moreTarget, overflow]
    );
    // Stable row callbacks so memoized PostCards do not re-render on every list
    // tick. Inline closures here used to defeat the memo on every scroll frame.
    const handleOpenMore = useCallback(
      (target: FeedPost, anchor: MenuAnchor) => {
        setMoreTarget({ anchor, post: target });
      },
      []
    );
    const handleShare = useCallback((post: FeedPost) => {
      setSharePost(post);
    }, []);
    const handleCloseShare = useCallback(() => {
      setSharePost(null);
    }, []);
    const handleCloseMore = useCallback(() => {
      setMoreTarget(null);
    }, []);

    // Restore this tab's scroll position when it (re)mounts with content.
    const memoryKey = `home:${variant}:${userId ?? "guest"}`;
    // A tab the reader was just sent to (their own post landing at the head of
    // Latest) must land at the top, not at the offset they left it at. The
    // request is one-shot and claimed here, so the memory restore below is
    // skipped for that visit instead of the two fighting over the offset.
    const jumpedToTop = useRef(false);
    const restoredScroll = useRef(false);
    useEffect(() => {
      if (!isActive || !consumeFeedTop(variant)) {
        return;
      }
      jumpedToTop.current = true;
      scrollMemory.delete(memoryKey);
      scrollOffset.set(0);
      headerScrollOffset?.set(0);
      listRef.current?.scrollToOffset({ animated: false, offset: 0 });
    }, [isActive, memoryKey, variant, scrollOffset, headerScrollOffset]);

    // Requests that arrive while this feed is already on screen: the variant's
    // own (a publish landing in Latest) or the dock's "home" reselect, which
    // web's reselectFeedNavigation answers by taking the visible feed to the top.
    useEffect(() => {
      if (!isActive) {
        return;
      }
      return subscribeFeedTopRequests(() => {
        if (!consumeFeedTop(variant) && !consumeFeedTop("home")) {
          return;
        }
        scrollMemory.delete(memoryKey);
        scrollOffset.set(0);
        headerScrollOffset?.set(0);
        listRef.current?.scrollToOffset({ animated: true, offset: 0 });
      });
    }, [isActive, memoryKey, variant, scrollOffset, headerScrollOffset]);

    useEffect(() => {
      const hasVisiblePosts =
        (source !== "bluesky" && posts.length > 0) ||
        (source !== "asm" && externalPosts.length > 0);
      if (!hasVisiblePosts) {
        restoredScroll.current = false;
        return;
      }
      if (status !== "success" && external.status !== "success") {
        return;
      }
      if (jumpedToTop.current || restoredScroll.current) {
        return;
      }
      const offset = scrollMemory.get(memoryKey) ?? 0;
      if (offset > 0) {
        const timer = setTimeout(() => {
          restoredScroll.current = true;
          scrollOffset.set(offset);
          scrollVisibility.set({ baseline: offset, hidden: false });
          listRef.current?.scrollToOffset({ animated: false, offset });
        }, 60);
        return () => clearTimeout(timer);
      }
      restoredScroll.current = true;
      // Restore once after content arrives, never on pagination or refresh.
      // oxlint-disable-next-line react/exhaustive-effect-dependencies -- one-shot restore on content arrival, not a subscription
    }, [
      memoryKey,
      posts.length,
      externalPosts.length,
      external.status,
      source,
      status,
      scrollVisibility,
      scrollOffset,
    ]);

    // A freshly shown tab starts with the header visible; its own scroll
    // takes over hiding from there. Becoming active always publishes the
    // retained viewable ids (even when empty) so stale ids from the previous
    // tab cannot keep an off-screen video playing.
    useEffect(() => {
      enabledRef.current = isActive;
      setFeedMediaActive(memoryKey, isActive);
      if (isActive) {
        const offset = Math.max(0, scrollOffset.get());
        headerScrollOffset?.set(offset);
        scrollVisibility.set({ baseline: offset, hidden: false });
        scrollActive.set(true);
        resetHeaderScroll(offset);
        const stored = latestVisibleRef.current;
        setVisiblePostIds(stored);
        setAutoplayPostId(latestAutoplayRef.current);
        return () => {
          enabledRef.current = false;
          setFeedMediaActive(memoryKey, false);
          scrollActive.set(false);
          scrollMemory.set(memoryKey, Math.max(0, scrollOffset.get()));
          setVisiblePostIds(new Set());
          setAutoplayPostId(null);
        };
      }
    }, [
      isActive,
      memoryKey,
      scrollActive,
      scrollOffset,
      scrollVisibility,
      headerScrollOffset,
    ]);

    const publishVisibleIds = useCallback(
      (ids: ReadonlySet<string>, autoplayPostId: string | null) => {
        latestVisibleRef.current = ids;
        latestAutoplayRef.current = autoplayPostId;
        if (!enabledRef.current) {
          return;
        }
        // Enqueue synchronously; read fresh credentials once when the batch
        // flushes, rather than storing an expiring cookie for this list's lifetime.
        if (ids.size > 0) {
          useFeedExposures.getState().remember(userId ?? "guest", [...ids]);
          for (const id of ids) {
            if (id.startsWith("at://")) {
              continue;
            }
            viewBatcher.mark(id, {
              apiBase: getApiBaseUrl(),
              getCookie: () => authClient.getCookie(),
            });
          }
        }
        setVisiblePostIds(new Set(ids));
        // Exactly one tile autoplays, the topmost visible video of this tab.
        setAutoplayPostId(autoplayPostId);
      },
      [userId]
    );

    const handleViewableItemsChanged = useCallback(
      ({ viewableItems }: { viewableItems: ViewToken<TimelineRow>[] }) => {
        const ids = new Set<string>();
        let autoplayPostId: string | null = null;
        const ordered = orderByIndex(viewableItems);
        for (const item of ordered) {
          const post =
            item.item.kind === "bluesky"
              ? externalPostView(item.item.value)
              : nativePostForRow(item.item);
          if (post) {
            ids.add(post.id);
            if (!autoplayPostId && hasVideoAttachment(post)) {
              autoplayPostId = post.id;
            }
          }
        }
        publishVisibleIds(ids, autoplayPostId);
      },
      [publishVisibleIds]
    );

    // Above every early return below: a hook called after one is conditional.
    const refreshing = status === "refreshing";
    const pull = usePullToRefresh({
      failed: status === "error",
      onRefresh: () => {
        refresh();
        external.refresh();
      },
      refreshing,
    });
    const saveOffset = useCallback(
      (offset: number) => {
        scrollMemory.set(memoryKey, Math.max(0, offset));
      },
      [memoryKey]
    );
    const publishHidden = useCallback((hidden: boolean) => {
      if (enabledRef.current) {
        setHeaderHidden(hidden);
      }
    }, []);
    const reportPullOffset = pull.onScrollOffset;
    const endPull = pull.onScrollEndDrag;
    const handleScroll = useAnimatedScrollHandler({
      onBeginDrag: () => {
        userScrolling.set(true);
      },
      onEndDrag: (event) => {
        userScrolling.set(false);
        scheduleOnRN(saveOffset, event.contentOffset.y);
        scheduleOnRN(endPull);
      },
      onMomentumBegin: () => {
        userScrolling.set(true);
      },
      onMomentumEnd: (event) => {
        userScrolling.set(false);
        scheduleOnRN(saveOffset, event.contentOffset.y);
      },
      onScroll: (event) => {
        const offset = event.contentOffset.y;
        const previous = scrollOffset.get();
        scrollOffset.set(offset);
        if (scrollActive.get()) {
          headerScrollOffset?.set(Math.max(0, offset));
          const state = scrollVisibility.get();
          const next = { ...state };
          if (userScrolling.get()) {
            advanceHeaderScroll(next, offset);
          } else {
            next.baseline = Math.max(0, offset);
          }
          scrollVisibility.set(next);
          if (next.hidden !== state.hidden) {
            scheduleOnRN(publishHidden, next.hidden);
          }
          if (!userScrolling.get()) {
            scheduleOnRN(saveOffset, offset);
          }
          if (offset < 16 && previous >= 16) {
            scheduleOnRN(clearNewItems);
          }
          // Ordinary scrolling stays on the UI thread. The custom refresh
          // loader only needs top crossings and iOS bounce distances on JS.
          if (offset <= 0 || previous <= 0) {
            scheduleOnRN(reportPullOffset, offset);
          }
        }
      },
    });
    // Stable row renderer: same identity across scroll ticks so memoized cards
    // skip re-renders. Depends only on stable callbacks + theme + variant.
    const showCommunityReason =
      variant === "trending" || variant === "personalized";
    const renderRow = useCallback(
      ({ item }: { item: TimelineRow }) => {
        if (item.kind === "bluesky") {
          return <BlueskyPostCard onShare={handleShare} post={item.value} />;
        }
        const row = item.value;
        return (
          <View
            style={[
              styles.group,
              {
                borderBottomColor: theme.cardBorder,
                borderBottomWidth: row.hasThreadChild ? 0 : 1,
              },
            ]}
          >
            <PostCard
              active
              hasThreadChild={row.hasThreadChild}
              hasThreadParent={row.hasThreadParent}
              onMore={handleOpenMore}
              onShare={handleShare}
              post={row.post}
              showAlt={altVisibleIds.has(row.post.id)}
              showCommunityReason={showCommunityReason}
              viewerId={userId}
            />
          </View>
        );
      },
      [
        altVisibleIds,
        handleOpenMore,
        handleShare,
        showCommunityReason,
        theme.cardBorder,
        userId,
      ]
    );
    const prefetchKey = JSON.stringify(
      feedPrefetchUrls(posts, getApiBaseUrl())
    );
    useEffect(() => {
      if (!enabled || prefetchKey === "[]") {
        return;
      }
      const urls: string[] = JSON.parse(prefetchKey);
      const timer = setTimeout(() => {
        void Promise.allSettled(
          urls.map((url) => Image.prefetch(url, { cachePolicy: "disk" }))
        );
      }, 600);
      return () => clearTimeout(timer);
    }, [enabled, prefetchKey]);

    const listHeader = <View style={{ height: headerHeight }} />;
    const rows = useMemo(
      () =>
        mixedFeedRows(
          incomingFeedRows(posts, incomingIds),
          externalPosts,
          source,
          // Web's Following passes sortBy="server" (ec04294a), so its two
          // sources interleave instead of merging by timestamp. Only Latest
          // is chronological.
          variant === "latest"
        ),
      [externalPosts, incomingIds, posts, source, variant]
    );
    const externalPending = source !== "asm" && external.status === "loading";
    const preferencesFailed = !network.ready && Boolean(network.error);
    const availability = preferencesFailed
      ? "error"
      : feedAvailability({
          count: rows.length,
          externalEnabled: source !== "asm",
          externalError: external.status === "error",
          externalLoading: externalPending,
          nativeEnabled: source !== "bluesky",
          nativeError: status === "error",
          nativeLoading: status === "loading" || (status === "idle" && enabled),
        });
    const combinedHasMore =
      (source !== "bluesky" && hasMore) ||
      (source !== "asm" && external.hasMore);
    // Web's useBoundedSourcePending: while one source's first page is still
    // in flight, hold the list at its first row so a page-sized batch from
    // the faster source is not locked in ahead of its peer. Following waits
    // up to the remote read deadline (18s), every other feed 600ms.
    const nativeInitialLoading =
      source !== "bluesky" &&
      (status === "loading" || (status === "idle" && enabled));
    const externalInitialLoading = externalPending;
    const initialSourceLoading = nativeInitialLoading || externalInitialLoading;
    const sourcesPending = useBoundedSourcePending(
      source === "all" && initialSourceLoading,
      variant === "following"
        ? FOLLOWING_INITIAL_SOURCE_WAIT_MS
        : DEFAULT_SOURCE_WAIT_MS
    );
    const visibleRows = sourcesPending ? rows.slice(0, 1) : rows;
    const nativeFailed = source !== "bluesky" && status === "error";
    const externalFailed = source !== "asm" && external.status === "error";
    const sourceFailed = nativeFailed || externalFailed;
    const sourceFetching =
      (source !== "bluesky" &&
        (status === "loading-more" || status === "refreshing")) ||
      (source !== "asm" && external.loadingMore);
    const retryNative = () => {
      if (hasMore && posts.length > 0) {
        fetchNext();
      } else {
        refresh();
      }
    };
    const retryExternal = () => {
      void external.retry();
    };
    const retryFailedSources = () => {
      if (nativeFailed) {
        retryNative();
      }
      if (externalFailed) {
        retryExternal();
      }
    };

    // Account-only tabs. For you is ranked from the viewer's own signals and
    // Following is their people, so neither means anything without an account;
    // the tab stays tappable (a guest discovers the feature) but the feed is
    // replaced by a sign-in prompt, matching web's AuthPromptCard.
    if ((variant === "following" || variant === "personalized") && !user) {
      const copy = EMPTY_COPY[variant];
      return (
        <View
          style={[
            styles.centerWrap,
            { paddingBottom: bottomInset + HEADER_BAR_HEIGHT },
          ]}
        >
          <AuthPromptCard
            description={
              variant === "following"
                ? GUEST_FOLLOWING_DESCRIPTION
                : copy.description
            }
            imageSize={128}
            title={
              variant === "personalized"
                ? "Log in for a feed made for you"
                : "Log in to see your feed"
            }
          />
        </View>
      );
    }

    // The shared editor stays above loading and empty feeds as well as populated lists.
    if (availability === "loading") {
      return (
        <FeedState>
          {listHeader}
          <FeedSkeleton posts={posts} />
        </FeedState>
      );
    }

    if (availability === "error") {
      let message =
        "We couldn’t load your feed right now. Please try again in a moment.";
      if (preferencesFailed) {
        message = "We couldn’t load your feed preferences. Please try again.";
      } else if (variant === "following") {
        message =
          "We couldn’t load posts from the people you follow. Please try again.";
      }
      return (
        <FeedState>
          {listHeader}
          <View
            style={{ flex: 1, paddingBottom: bottomInset + HEADER_BAR_HEIGHT }}
          >
            <FeedErrorState
              message={message}
              onRetry={() => {
                if (preferencesFailed) {
                  void network.refetch();
                } else {
                  retryFailedSources();
                }
              }}
            />
          </View>
        </FeedState>
      );
    }

    if (availability === "empty" && !combinedHasMore && !externalPending) {
      const copy = EMPTY_COPY[variant];
      // Web's home feed swaps to an interest-profile message whenever the
      // reader's network settings narrow the ranked feeds.
      const interestScoped =
        variant !== "following" &&
        activeNetworkInterests(network.settings.preferences).length > 0;
      const title = interestScoped
        ? "No Fleets match this profile yet."
        : copy.title;
      const description = interestScoped
        ? "Try another profile or add interests in Network settings."
        : copy.description;
      return (
        <FeedState>
          {listHeader}
          <View
            style={[
              styles.centerWrap,
              { paddingBottom: bottomInset + HEADER_BAR_HEIGHT },
            ]}
          >
            <Image
              contentFit="contain"
              source={noFeedImage}
              style={styles.emptyArt}
            />
            <Text style={[styles.emptyTitle, { color: theme.dividerText }]}>
              {title}
            </Text>
            {description ? (
              <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
                {description}
              </Text>
            ) : null}
          </View>
        </FeedState>
      );
    }
    const authors: PillAuthor[] = [
      ...new Map(
        [...newItems, ...external.newItems.map(externalPostView)].map(
          (post) => [
            post.userId,
            {
              avatarUrl: post.user?.avatarUrl,
              id: post.userId,
              username: post.user?.username,
            },
          ]
        )
      ).values(),
    ];

    const showLoader =
      (source !== "bluesky" && status === "loading-more") ||
      (source !== "asm" && external.loadingMore) ||
      sourcesPending ||
      (initialSourceLoading && rows.length > 0);
    // Web's feedComplete: no more pages, nothing loading or fetching, and
    // no source failed. A failed Bluesky read never claims "caught up".
    const feedComplete =
      !combinedHasMore &&
      !initialSourceLoading &&
      !showLoader &&
      !sourceFetching &&
      !sourceFailed &&
      rows.length > 0;
    // Web's manual continuation: offered only after a source failed, when
    // nothing is in flight. Healthy paging stays automatic.
    const manualContinuation =
      combinedHasMore && sourceFailed && !sourceFetching && !showLoader;
    const partialErrors: ReactNode[] = [];
    if (variant === "following") {
      if (externalFailed) {
        partialErrors.push(
          <FeedErrorState
            compact
            key="bluesky"
            isRetrying={external.loadingMore}
            message="Bluesky posts couldn’t load right now. Please try again in a moment."
            onRetry={retryExternal}
          />
        );
      }
      if (nativeFailed) {
        partialErrors.push(
          <FeedErrorState
            compact
            key="asm"
            message="Some posts couldn’t load right now. Please try again."
            onRetry={retryNative}
          />
        );
      }
    }
    const header =
      partialErrors.length > 0 ? (
        <View>
          {listHeader}
          {partialErrors}
        </View>
      ) : (
        listHeader
      );
    let footer: ReactNode = null;
    if (showLoader) {
      // Post skeletons while paginating, like web's LoadMoreSkeleton (two
      // cards), instead of a bare spinner.
      footer = (
        <View>
          {[0, 1].map((index) => (
            <View
              key={index}
              style={[styles.group, { borderBottomColor: theme.cardBorder }]}
            >
              <FeedSkeletonCard />
            </View>
          ))}
        </View>
      );
    } else if (sourceFailed && variant !== "following") {
      footer = (
        <View>
          <FeedErrorState
            compact
            message="Some posts couldn’t load. Your loaded posts are still here—please try again."
            onRetry={retryFailedSources}
          />
          {manualContinuation ? (
            <LoadMoreButton onPress={retryFailedSources} />
          ) : null}
        </View>
      );
    } else if (manualContinuation) {
      footer = <LoadMoreButton onPress={retryFailedSources} />;
    } else if (feedComplete) {
      footer = (
        <View style={styles.endWrap}>
          <Image
            contentFit="contain"
            source={notFoundImage}
            style={styles.endArt}
          />
          <Text style={[styles.endText, { color: theme.dividerText }]}>
            You&apos;re all caught up!
          </Text>
        </View>
      );
    }
    return (
      <FeedMediaScope.Provider value={memoryKey}>
        <GestureDetector gesture={pull.gesture}>
          <View style={styles.listWrap}>
            <Animated.View
              style={[
                styles.listShift,
                { transform: [{ translateY: pull.pullShift }] },
              ]}
            >
              <GestureDetector gesture={pull.nativeScrollGesture}>
                <Reanimated.FlatList
                  contentContainerStyle={{
                    paddingBottom: HEADER_BAR_HEIGHT + bottomInset,
                  }}
                  data={visibleRows}
                  maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                  keyExtractor={feedRowKey}
                  {...LIST_VIRTUALIZATION_PROPS}
                  onEndReached={() => {
                    // A failed source waits for the reader's retry instead of
                    // re-firing on every end-reached, like web's manual gate.
                    if (sourcesPending) {
                      return;
                    }
                    if (source !== "bluesky" && status !== "error") {
                      fetchNext();
                    }
                    if (source !== "asm" && external.status !== "error") {
                      void external.fetchNext();
                    }
                  }}
                  onEndReachedThreshold={0.5}
                  onScroll={handleScroll}
                  onViewableItemsChanged={handleViewableItemsChanged}
                  // Detach native rows outside the viewport while retaining
                  // their React state, measured heights and complete content.
                  removeClippedSubviews={Platform.OS === "android"}
                  ref={listRef}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
                  viewabilityConfig={STABLE_VIEWABILITY}
                  renderItem={renderRow}
                  ListFooterComponent={footer ?? undefined}
                  // The spacer and editor move together; preserving the visible
                  // spacer prevents typing from scrolling the editor out of view.
                  ListHeaderComponent={header ?? undefined}
                />
              </GestureDetector>
            </Animated.View>
            {pull.loader}
            {(source === "bluesky" ? 0 : newItems.length) +
              (source === "asm" ? 0 : external.newItems.length) >
            0 ? (
              <NewContentPill
                authors={authors}
                count={
                  (source === "bluesky" ? 0 : newItems.length) +
                  (source === "asm" ? 0 : external.newItems.length)
                }
                onPress={() => {
                  haptic();
                  showNewPosts();
                  external.acceptNew();
                  // Web's revealFeedHead (83655878): commit the new head
                  // first, then scroll, so maintainVisibleContentPosition
                  // cannot re-anchor and cancel the jump.
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      listRef.current?.scrollToOffset({
                        animated: true,
                        offset: 0,
                      });
                    });
                  });
                }}
              />
            ) : null}
            <ShareSheet onClose={handleCloseShare} post={sharePost} />
            <MoreMenu
              anchor={moreTarget?.anchor ?? null}
              entries={
                moreTarget
                  ? buildMoreEntries({
                      post: moreTarget.post,
                      showCaptions,
                      showingAlt: altVisibleIds.has(moreTarget.post.id),
                      viewerId: user?.id,
                    })
                  : []
              }
              onAction={handleMoreAction}
              onClose={handleCloseMore}
            />
            {overflow.dialogs}
          </View>
        </GestureDetector>
      </FeedMediaScope.Provider>
    );
  }
);

FeedList.displayName = "FeedList";

export function clearFeedScrollMemory(): void {
  scrollMemory.clear();
}

const styles = StyleSheet.create({
  centerWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  emptyArt: {
    height: 160,
    width: "100%",
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  emptyTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 12,
    textAlign: "center",
  },
  endArt: {
    height: 160,
    width: "100%",
  },
  endText: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  endWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 56,
  },
  footer: {
    paddingVertical: 20,
  },
  group: {
    borderBottomWidth: 1,
  },
  listShift: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
    position: "relative",
  },
  loadMore: { alignItems: "center", padding: 16 },
  loadMorePill: { height: 36, paddingHorizontal: 16 },
  loadMorePressed: { transform: [{ translateY: 1 }] },
  loadMoreText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 14 },
  stateWrap: {
    flex: 1,
  },
});
