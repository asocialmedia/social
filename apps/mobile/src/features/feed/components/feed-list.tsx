// One tab's feed list: thread-grouped post cards in a FlatList with
// pull-refresh, infinite scroll, per-tab scroll memory (restores position
// when switching tabs, like web's useFeedScrollMemory), the new-content
// pill overlay, and loading/error/empty/end states mirroring web HomeFeed.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Animated,
  Easing,
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PanResponderInstance } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import errorImage from "@/assets/images/error.png";
import noFeedImage from "@/assets/images/nofeed.png";
import notFoundImage from "@/assets/images/notfound.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import type { FeedVariant } from "../lib/feed-api";
import { groupPostsIntoThreads } from "../lib/feed-types";
import type { FeedPost, FeedThreadGroup } from "../lib/feed-types";
import {
  HEADER_BAR_HEIGHT,
  reportFeedScroll,
  resetHeaderScroll,
} from "../lib/header-visibility";
import { hasVideoAttachment } from "../lib/media-kind";
import { viewBatcher } from "../lib/view-batcher";
import { setAutoplayPostId, setVisiblePostIds } from "../lib/visible-posts";
import { feedCache } from "../state/feed-store";
import { useFeedTab } from "../state/use-feed";
import { useVideoCaptionsStore } from "../state/video-captions-store";
import { FeedSkeleton, FeedSkeletonCard } from "./feed-skeleton";
import { buildMoreEntries, MoreMenu } from "./more-menu";
import type { MenuAnchor, MoreAction } from "./more-menu";
import { NewContentPill } from "./new-content-pill";
import type { PillAuthor } from "./new-content-pill";
import { PostCard } from "./post-card";
import { PULL_THRESHOLD, PullLoader } from "./pull-loader";
import { ShareSheet } from "./share-sheet";

// Scroll offsets survive tab switches (and unmounts) like web's
// useFeedScrollMemory with memoryKey `home:${tab}`.
const scrollMemory = new Map<string, number>();

// Custom pull-to-refresh on both platforms (the indicator is PullLoader). iOS
// bounces natively, so the distance reads straight off the negative content
// offset. Android clamps the offset at zero, so a vertical pan captured at
// the top of the list measures the pull instead (with rubber-band
// resistance), replacing the Material RefreshControl indicator.
const PULL_RESISTANCE = 0.55;
const PULL_CAPTURE_SLOP = 8;
// Where the Android list parks while refreshing: the 44px loader chip at
// top 12 plus breathing room.
const PULL_PARK = 64;

// Android pull, on native gestures: a JS responder loses the drag to the
// native scroll view the moment it starts, so the pull is a gesture-handler
// Pan running simultaneously with the list's own native scroll gesture. It
// measures only the part of the drag made while the list sits at the very
// top (baseline taken when the offset first reaches zero), so scrolling back
// up and continuing into a pull works like iOS. Horizontal drags fail it and
// stay with the tab pager. Built once per list; the handlers only read refs.
function createPullGestures(refs: {
  // The list's slide: follows the pull, parks under the spinner while
  // refreshing, springs home otherwise.
  pullShift: Animated.Value;
  pullRef: RefObject<number>;
  pullUpdateRef: RefObject<((distance: number) => void) | null>;
  refreshRef: RefObject<() => void>;
  refreshingRef: RefObject<boolean>;
  scrollOffsetRef: RefObject<number>;
}) {
  let baseline: number | null = null;
  const resetPull = () => {
    baseline = null;
    refs.pullRef.current = 0;
    refs.pullUpdateRef.current?.(0);
  };
  const nativeScroll = Gesture.Native();
  const pull = Gesture.Pan()
    .enabled(Platform.OS === "android")
    .runOnJS(true)
    .activeOffsetY(PULL_CAPTURE_SLOP)
    .failOffsetX([-PULL_CAPTURE_SLOP * 2, PULL_CAPTURE_SLOP * 2])
    .simultaneousWithExternalGesture(nativeScroll)
    .onUpdate((event) => {
      if (refs.refreshingRef.current || refs.scrollOffsetRef.current > 0) {
        if (refs.pullRef.current > 0) {
          resetPull();
        }
        return;
      }
      if (baseline === null) {
        baseline = event.translationY;
      }
      const distance =
        Math.max(0, event.translationY - baseline) * PULL_RESISTANCE;
      if (Math.abs(distance - refs.pullRef.current) > 1) {
        refs.pullRef.current = distance;
        refs.pullUpdateRef.current?.(distance);
        refs.pullShift.setValue(distance);
      }
    })
    .onFinalize(() => {
      const trigger =
        !refs.refreshingRef.current && refs.pullRef.current > PULL_THRESHOLD;
      if (trigger) {
        refs.refreshRef.current();
      }
      Animated.spring(refs.pullShift, {
        bounciness: 0,
        toValue: trigger ? PULL_PARK : 0,
        useNativeDriver: true,
      }).start();
      resetPull();
    });
  return { nativeScroll, pull };
}

// Floating feed scrollbar: native port of web's FeedScrollbar. The system
// indicator is hidden; an orange 3D thumb overlays the right edge, appears
// while scrolling, auto-hides after 800ms, and drags to scroll.
const SCROLL_MIN_THUMB = 48;
const SCROLL_MAX_THUMB = 96;
const SCROLL_HIDE_DELAY = 800;

const SCROLL_THUMB_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.08)";
const SCROLL_THUMB_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1px 1.5px rgba(255, 255, 255, 0.5), 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 4px rgba(0, 0, 0, 0.12)";

interface ScrollMetrics {
  container: number;
  content: number;
  offset: number;
}

function FeedScrollbar({
  listRef,
  metricsRef,
  registerRef,
}: {
  listRef: RefObject<FlatList<FeedThreadGroup> | null>;
  metricsRef: RefObject<ScrollMetrics>;
  registerRef: RefObject<((offset: number) => void) | null>;
}) {
  const { isDark } = useAppTheme();
  const [geometry, setGeometry] = useState({
    height: 0,
    translate: 0,
    visible: false,
  });
  const [showing, setShowing] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ height: 0, offset: 0, translate: 0 });
  const dragStart = useRef({ offset: 0, translate: 0 });
  const [panResponder, setPanResponder] = useState<PanResponderInstance | null>(
    null
  );

  useEffect(() => {
    const timer = hideTimer.current;
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  const show = useCallback(() => {
    setShowing(true);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setShowing(false);
    }, SCROLL_HIDE_DELAY);
  }, []);

  const update = (offset: number) => {
    const metrics = metricsRef.current;
    if (!metrics) {
      return;
    }
    metrics.offset = offset;
    const { container, content } = metrics;
    if (!container || content <= container) {
      setGeometry((current) =>
        current.visible ? { ...current, visible: false } : current
      );
      return;
    }
    const height = Math.min(
      Math.max((container / content) * container, SCROLL_MIN_THUMB),
      SCROLL_MAX_THUMB
    );
    const maxTranslate = container - height;
    const scrollable = content - container;
    const translate = scrollable > 0 ? (offset / scrollable) * maxTranslate : 0;
    latest.current = { height, offset, translate };
    setGeometry((current) =>
      current.height === height &&
      current.translate === translate &&
      current.visible
        ? current
        : { height, translate, visible: true }
    );
    show();
  };

  useEffect(() => {
    registerRef.current = update;
    return () => {
      registerRef.current = null;
    };
  });

  // Built once in an effect (never during render): the handlers only touch
  // refs and stable setState, so the first instance stays valid for life.
  useEffect(() => {
    const responder = PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = {
          offset: latest.current.offset,
          translate: latest.current.translate,
        };
        if (hideTimer.current) {
          clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
        setShowing(true);
      },
      onPanResponderMove: (_, gesture) => {
        const metrics = metricsRef.current;
        const list = listRef.current;
        if (!(metrics && list)) {
          return;
        }
        const { container, content } = metrics;
        const scrollable = content - container;
        if (scrollable <= 0) {
          return;
        }
        const maxTranslate = container - latest.current.height;
        if (maxTranslate <= 0) {
          return;
        }
        const translate = Math.min(
          Math.max(dragStart.current.translate + gesture.dy, 0),
          maxTranslate
        );
        const offset = (translate / maxTranslate) * scrollable;
        latest.current = { ...latest.current, offset, translate };
        setGeometry((current) => ({ ...current, translate }));
        list.scrollToOffset({ animated: false, offset });
      },
      onPanResponderRelease: () => {
        show();
      },
      onPanResponderTerminate: () => {
        show();
      },
      onStartShouldSetPanResponder: () => true,
    });
    // oxlint-disable-next-line react/set-state-in-effect -- one-time responder setup; handlers are stable for the component's life
    setPanResponder(responder);
  }, [dragStart, hideTimer, latest, listRef, metricsRef, show]);

  if (!geometry.visible) {
    return null;
  }
  return (
    <View pointerEvents="box-none" style={styles.scrollTrack}>
      <LinearGradient
        colors={["#ff9500", "#e65500"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={[
          styles.scrollThumb,
          {
            borderColor: isDark
              ? "rgba(170, 60, 0, 0.95)"
              : "rgba(170, 60, 0, 0.5)",
            boxShadow: isDark
              ? SCROLL_THUMB_SHADOWS_DARK
              : SCROLL_THUMB_SHADOWS,
            height: geometry.height,
            opacity: showing ? 1 : 0,
            transform: [
              { translateY: geometry.translate },
              { translateX: showing ? 0 : 6 },
            ],
          },
        ]}
        {...panResponder?.panHandlers}
      />
    </View>
  );
}

const EMPTY_COPY: Record<FeedVariant, { description: string; title: string }> =
  {
    following: {
      description:
        "Follow people you love and their fleets will land right here.",
      title: "No following fleets yet.",
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

interface FeedListProps {
  // Extra tail padding when an overlay (guest banner + floating dock) sits
  // over the feed's end, so the last post scrolls clear of it. End padding
  // never moves visible items, so it can jump with overlay visibility.
  bottomInset?: number;
  enabled: boolean;
  userId: string | undefined;
  variant: FeedVariant;
}

export function FeedList({
  bottomInset = 0,
  enabled,
  userId,
  variant,
}: FeedListProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const listRef = useRef<FlatList<FeedThreadGroup>>(null);
  const metricsRef = useRef<ScrollMetrics>({
    container: 0,
    content: 0,
    offset: 0,
  });
  const scrollbarUpdate = useRef<((offset: number) => void) | null>(null);
  const pullRef = useRef(0);
  // Pull distance writes here without re-rendering the list; PullLoader owns
  // the progress state and registers its setter through this ref.
  const pullUpdateRef = useRef<((distance: number) => void) | null>(null);
  // Android pull: the list's scroll offset and the latest refresh state are
  // read through refs, since the responder is built once.
  const scrollOffsetRef = useRef(0);
  const refreshingRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {
    /* empty */
  });

  // Latest viewable ids are retained so the tab can publish them when it
  // becomes enabled; the FlatList retains the first closure, so enabled is
  // read through a ref.
  const enabledRef = useRef(enabled);
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
  const toggleCaptions = useVideoCaptionsStore((state) => state.toggleCaptions);
  const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [lastDismissed, setLastDismissed] = useState<string | null>(null);
  const {
    dismissPost,
    error,
    fetchNext,
    hasMore,
    newItems,
    posts,
    refresh,
    showNewPosts,
    status,
    undoDismiss,
  } = useFeedTab({ enabled, userId, variant });

  // Reconcile batched view counts into every cached tab, like web's
  // applyViewCountToCaches. All mounted tab lists share one batcher; only
  // clear the handler if it is still ours.
  useEffect(() => {
    const reconcile = (counts: Record<string, number>) => {
      for (const [postId, viewCount] of Object.entries(counts)) {
        feedCache.updatePostEverywhere(postId, { viewCount });
      }
    };
    viewBatcher.onFlush = reconcile;
    return () => {
      if (viewBatcher.onFlush === reconcile) {
        viewBatcher.onFlush = null;
      }
    };
  }, []);

  const handleMoreAction = (action: MoreAction) => {
    const morePost = moreTarget?.post;
    if (!morePost) {
      return;
    }
    if (action.type === "hide") {
      dismissPost(morePost.id);
      setLastDismissed(morePost.id);
    } else if (action.type === "toggle-captions") {
      toggleCaptions();
    } else if (action.type === "toggle-alt") {
      setAltVisibleIds((current) => {
        const next = new Set(current);
        if (next.has(morePost.id)) {
          next.delete(morePost.id);
        } else {
          next.add(morePost.id);
        }
        return next;
      });
    }
  };

  useEffect(() => {
    refreshingRef.current = status === "refreshing";
    refreshRef.current = refresh;
  }, [refresh, status]);

  // Android pull on native gestures; see createPullGestures. The ref objects
  // are handed over, never read, during render: only the gesture callbacks
  // touch `.current`, on touch events.
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [pullShift] = useState(() => new Animated.Value(0));
  // oxlint-disable-next-line react/hook-use-state, react/refs -- single stable gesture pair created once; no setter is ever needed and no ref value is read here
  const [pullGestures] = useState(() =>
    createPullGestures({
      pullRef,
      pullShift,
      pullUpdateRef,
      refreshRef,
      refreshingRef,
      scrollOffsetRef,
    })
  );

  // Restore this tab's scroll position when it (re)mounts with content.
  const memoryKey = `home:${variant}`;
  useEffect(() => {
    if (status !== "success" || posts.length === 0) {
      return;
    }
    const offset = scrollMemory.get(memoryKey) ?? 0;
    if (offset > 0) {
      const timer = setTimeout(() => {
        listRef.current?.scrollToOffset({ animated: false, offset });
      }, 60);
      return () => clearTimeout(timer);
    }
    // Runs when content lands; offsets are keyed per tab.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- one-shot restore on content arrival, not a subscription
  }, [memoryKey, posts.length, status]);

  // The undo banner auto-dismisses like web's toast.
  useEffect(() => {
    if (lastDismissed) {
      const timer = setTimeout(() => setLastDismissed(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [lastDismissed]);

  // A freshly shown tab starts with the header visible; its own scroll
  // takes over hiding from there. Becoming enabled always publishes the
  // retained viewable ids (even when empty) so stale ids from the previous
  // tab cannot keep an off-screen video playing.
  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) {
      resetHeaderScroll();
      const stored = latestVisibleRef.current;
      setVisiblePostIds(stored);
      setAutoplayPostId(latestAutoplayRef.current);
    }
  }, [enabled]);

  const publishVisibleIds = useCallback(
    (ids: ReadonlySet<string>, autoplayPostId: string | null) => {
      latestVisibleRef.current = ids;
      latestAutoplayRef.current = autoplayPostId;
      if (!enabledRef.current) {
        return;
      }
      if (ids.size > 0) {
        const apiBase = getApiBaseUrl();
        void (async () => {
          const cookie = await authClient.getCookie();
          for (const id of ids) {
            viewBatcher.mark(id, { apiBase, cookie });
          }
        })();
      }
      setVisiblePostIds(new Set(ids));
      // Exactly one tile autoplays, the topmost visible video of this tab.
      setAutoplayPostId(autoplayPostId);
    },
    []
  );

  // Account-only tabs. For you is ranked from the viewer's own signals and
  // Following is their people, so neither means anything without an account;
  // the tab stays tappable (a guest discovers the feature) but the feed is
  // replaced by a sign-in prompt, matching web's AuthPromptCard.
  if ((variant === "following" || variant === "personalized") && !user) {
    const copy = EMPTY_COPY[variant];
    return (
      <View style={styles.centerWrap}>
        <View
          style={[
            styles.prompt,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <Text style={[styles.promptTitle, { color: theme.inputText }]}>
            {variant === "personalized"
              ? "Log in for a feed made for you"
              : "Log in to see your feed"}
          </Text>
          <Text style={[styles.promptBody, { color: theme.dividerText }]}>
            {copy.description}
          </Text>
          <Pressable
            onPress={() => router.push("/(auth)/login")}
            style={styles.promptBtn}
          >
            <Text style={styles.promptBtnText}>Log in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (status === "loading" || (status === "idle" && enabled)) {
    return <FeedSkeleton />;
  }

  if (status === "error" && posts.length === 0) {
    return (
      <View style={styles.centerWrap}>
        <Image
          contentFit="contain"
          source={errorImage}
          style={styles.emptyArt}
        />
        <Text style={[styles.errorTitle, { color: "#dc2626" }]}>
          An error occurred while loading posts.
        </Text>
        <Text style={[styles.errorBody, { color: theme.dividerText }]}>
          {error ?? "Please try again."}
        </Text>
        {__DEV__ ? (
          <Text style={[styles.errorBody, { color: theme.dividerText }]}>
            Dev build? Run `bun run dev:android --reverse-only` - the emulator
            loses its localhost ports on reboot.
          </Text>
        ) : null}
        <Pressable hitSlop={8} onPress={refresh} style={styles.retryRow}>
          <Text style={[styles.retryText, { color: theme.auxLink }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  if (status === "success" && posts.length === 0 && !hasMore) {
    const copy = EMPTY_COPY[variant];
    return (
      <View style={styles.centerWrap}>
        <Image
          contentFit="contain"
          source={noFeedImage}
          style={styles.emptyArt}
        />
        <Text style={[styles.emptyTitle, { color: theme.dividerText }]}>
          {copy.title}
        </Text>
        <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
          {copy.description}
        </Text>
      </View>
    );
  }

  const groups = groupPostsIntoThreads(posts);
  const authors: PillAuthor[] = [
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

  const showLoader = status === "loading-more";
  const refreshing = status === "refreshing";
  const showEnd = status === "success" && !hasMore && posts.length > 0;
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
  } else if (showEnd) {
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
    <GestureDetector gesture={pullGestures.pull}>
      <View style={styles.listWrap}>
        <Animated.View
          style={[styles.listShift, { transform: [{ translateY: pullShift }] }]}
        >
          <GestureDetector gesture={pullGestures.nativeScroll}>
            <FlatList
              contentContainerStyle={{
                paddingBottom: HEADER_BAR_HEIGHT + bottomInset,
              }}
              data={groups}
              keyExtractor={(group) => group.id}
              onContentSizeChange={(_, height) => {
                metricsRef.current.content = height;
                scrollbarUpdate.current?.(metricsRef.current.offset);
              }}
              onEndReached={fetchNext}
              onEndReachedThreshold={0.5}
              onLayout={(event) => {
                metricsRef.current.container = event.nativeEvent.layout.height;
                scrollbarUpdate.current?.(metricsRef.current.offset);
              }}
              onMomentumScrollEnd={(event) => {
                scrollMemory.set(memoryKey, event.nativeEvent.contentOffset.y);
              }}
              onScroll={(event) => {
                const offsetY = event.nativeEvent.contentOffset.y;
                scrollOffsetRef.current = offsetY;
                scrollbarUpdate.current?.(offsetY);
                if (enabledRef.current) {
                  reportFeedScroll(offsetY);
                }
                // iOS pull distance off the bounce (Android's comes from the pull
                // responder). Progress stays local to PullLoader via the ref: no
                // list re-render.
                if (!refreshing && offsetY < 0) {
                  const distance = -offsetY;
                  if (Math.abs(distance - pullRef.current) > 1) {
                    pullRef.current = distance;
                    pullUpdateRef.current?.(distance);
                  }
                } else if (pullRef.current > 0) {
                  pullRef.current = 0;
                  pullUpdateRef.current?.(0);
                }
              }}
              onScrollEndDrag={() => {
                if (!refreshing && pullRef.current > PULL_THRESHOLD) {
                  refresh();
                }
                pullRef.current = 0;
                pullUpdateRef.current?.(0);
              }}
              onViewableItemsChanged={({ viewableItems }) => {
                const ids = new Set<string>();
                let autoplayPostId: string | null = null;
                // Sorted so the "topmost visible" pick is deterministic; RN
                // does not promise an order for viewableItems.
                const ordered = [...viewableItems].toSorted(
                  (a, b) => (a.index ?? 0) - (b.index ?? 0)
                );
                for (const item of ordered) {
                  const group = item.item as FeedThreadGroup | undefined;
                  for (const post of group?.posts ?? []) {
                    ids.add(post.id);
                    // The owner is the first visible post that actually has a
                    // video; a text-only post at the top must not blank out
                    // playback for the video just below it.
                    if (!autoplayPostId && hasVideoAttachment(post)) {
                      autoplayPostId = post.id;
                    }
                  }
                }
                publishVisibleIds(ids, autoplayPostId);
              }}
              ref={listRef}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
              renderItem={({ item: group }) => (
                <View
                  style={[
                    styles.group,
                    { borderBottomColor: theme.cardBorder },
                  ]}
                >
                  {group.posts.map((post, index) => (
                    <PostCard
                      active={enabled}
                      hasThreadChild={index < group.posts.length - 1}
                      hasThreadParent={index > 0}
                      key={post.id}
                      onMore={(target, anchor) => {
                        setMoreTarget({ anchor, post: target });
                      }}
                      onShare={setSharePost}
                      post={post}
                      showAlt={altVisibleIds.has(post.id)}
                      showCommunityReason={
                        variant === "trending" || variant === "personalized"
                      }
                      viewerId={userId}
                    />
                  ))}
                </View>
              )}
              ListFooterComponent={footer}
            />
          </GestureDetector>
        </Animated.View>
        <PullLoader
          failed={status === "error"}
          onSettle={() => {
            // The parked Android list glides home with the chip.
            Animated.timing(pullShift, {
              duration: 240,
              easing: Easing.bezier(0.32, 0.72, 0, 1),
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }}
          refreshing={refreshing}
          registerUpdate={pullUpdateRef}
        />
        <FeedScrollbar
          listRef={listRef}
          metricsRef={metricsRef}
          registerRef={scrollbarUpdate}
        />
        {newItems.length > 0 ? (
          <NewContentPill
            authors={authors}
            count={newItems.length}
            onPress={() => {
              showNewPosts();
              listRef.current?.scrollToOffset({ animated: true, offset: 0 });
            }}
          />
        ) : null}
        {lastDismissed ? (
          <View style={styles.undoWrap} pointerEvents="box-none">
            <View
              style={[
                styles.undoBar,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Text style={[styles.undoText, { color: theme.dividerText }]}>
                Post hidden
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  if (lastDismissed) {
                    undoDismiss(lastDismissed);
                  }
                  setLastDismissed(null);
                }}
              >
                <Text style={[styles.undoAction, { color: theme.auxLink }]}>
                  Undo
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
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
          onClose={() => setMoreTarget(null)}
        />
      </View>
    </GestureDetector>
  );
}

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
  errorBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 12,
    textAlign: "center",
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
  prompt: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    maxWidth: 340,
    padding: 20,
    width: "100%",
  },
  promptBody: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    textAlign: "center",
  },
  promptBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 8,
    paddingVertical: 10,
  },
  promptBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  promptTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    textAlign: "center",
  },
  retryRow: {
    marginTop: 12,
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  scrollThumb: {
    borderRadius: 9999,
    borderWidth: 1,
    marginRight: 2,
    width: 6,
  },
  scrollTrack: {
    alignItems: "flex-end",
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 10,
    zIndex: 30,
  },
  undoAction: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  undoBar: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  undoText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
  },
  undoWrap: {
    alignItems: "center",
    bottom: 24,
    left: 0,
    position: "absolute",
    right: 0,
  },
});
