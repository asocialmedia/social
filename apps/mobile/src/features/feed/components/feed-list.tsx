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
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PanResponderInstance } from "react-native";

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
import { reportFeedScroll, resetHeaderScroll } from "../lib/header-visibility";
import { viewBatcher } from "../lib/view-batcher";
import { setVisiblePostIds } from "../lib/visible-posts";
import { feedCache } from "../state/feed-store";
import { useFeedTab } from "../state/use-feed";
import { FeedSkeleton, FeedSkeletonCard } from "./feed-skeleton";
import { MoreMenu } from "./more-menu";
import type { MoreAction } from "./more-menu";
import { NewContentPill } from "./new-content-pill";
import type { PillAuthor } from "./new-content-pill";
import { PostCard } from "./post-card";
import { ShareSheet } from "./share-sheet";
import { Spinner3D } from "./spinner-3d";

// Scroll offsets survive tab switches (and unmounts) like web's
// useFeedScrollMemory with memoryKey `home:${tab}`.
const scrollMemory = new Map<string, number>();

// Custom pull-to-refresh: web's 3D spinner grows in with the pull distance
// and spins while refreshing. iOS bounces natively so the pull distance
// reads straight off content offset; Android clamps at zero, so it keeps
// the platform indicator, tinted brand orange.
const PULL_THRESHOLD = 90;

function PullLoader({
  progress,
  refreshing,
}: {
  progress: number;
  refreshing: boolean;
}) {
  // Android keeps its platform indicator (see refreshControl below) and
  // clamps pull distance at zero, so the overlay is iOS-only: rendering it
  // on Android stacks two spinners.
  if (Platform.OS !== "ios") {
    return null;
  }
  if (!refreshing && progress <= 0) {
    return null;
  }
  const shown = refreshing ? 1 : Math.min(1, progress / PULL_THRESHOLD);
  return (
    <View pointerEvents="none" style={styles.pullWrap}>
      <View
        style={{
          opacity: shown,
          transform: [{ scale: 0.5 + 0.5 * shown }],
        }}
      >
        <Spinner3D size={32} />
      </View>
    </View>
  );
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
  enabled: boolean;
  userId: string | undefined;
  variant: FeedVariant;
}

export function FeedList({ enabled, userId, variant }: FeedListProps) {
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
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [morePost, setMorePost] = useState<FeedPost | null>(null);
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
    if (!morePost) {
      return;
    }
    if (action.type === "share") {
      setSharePost(morePost);
    } else if (action.type === "hide") {
      dismissPost(morePost.id);
      setLastDismissed(morePost.id);
    } else {
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
  // takes over hiding from there.
  useEffect(() => {
    if (enabled) {
      resetHeaderScroll();
    }
  }, [enabled]);

  if (variant === "following" && !user) {
    const copy = EMPTY_COPY.following;
    return (
      <View style={styles.centerWrap}>
        <View
          style={[
            styles.prompt,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <Text style={[styles.promptTitle, { color: theme.inputText }]}>
            Log in to see your feed
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
    <View style={styles.listWrap}>
      <FlatList
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
          scrollbarUpdate.current?.(offsetY);
          if (enabled) {
            reportFeedScroll(offsetY);
          }
          // Custom pull distance for the logo loader (iOS bounce only;
          // Android clamps at zero and keeps its platform indicator).
          if (!refreshing && offsetY < 0) {
            const distance = -offsetY;
            if (Math.abs(distance - pullRef.current) > 1) {
              pullRef.current = distance;
              setPull(distance);
            }
          } else if (pullRef.current > 0) {
            pullRef.current = 0;
            setPull(0);
          }
        }}
        onScrollEndDrag={() => {
          if (!refreshing && pullRef.current > PULL_THRESHOLD) {
            refresh();
          }
          pullRef.current = 0;
          setPull(0);
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          const ids: string[] = [];
          for (const item of viewableItems) {
            const group = item.item as FeedThreadGroup | undefined;
            for (const post of group?.posts ?? []) {
              ids.push(post.id);
            }
          }
          if (ids.length > 0) {
            const apiBase = getApiBaseUrl();
            void (async () => {
              const cookie = await authClient.getCookie();
              for (const id of ids) {
                viewBatcher.mark(id, { apiBase, cookie });
              }
            })();
          }
          // Viewport autoplay: videos play while their post is viewable.
          setVisiblePostIds(new Set(ids));
        }}
        ref={listRef}
        refreshControl={
          // iOS uses the custom logo pull above; Android keeps the
          // platform indicator, tinted brand orange (custom views are
          // not hostable in RefreshControl).
          Platform.OS === "ios" ? undefined : (
            <RefreshControl
              colors={["#ff9500"]}
              onRefresh={refresh}
              progressBackgroundColor={theme.cardBg}
              refreshing={refreshing}
              tintColor="#ff9500"
            />
          )
        }
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item: group }) => (
          <View style={[styles.group, { borderBottomColor: theme.cardBorder }]}>
            {group.posts.map((post, index) => (
              <PostCard
                hasThreadChild={index < group.posts.length - 1}
                hasThreadParent={index > 0}
                key={post.id}
                onMore={setMorePost}
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
      <PullLoader progress={pull} refreshing={refreshing} />
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
        onAction={handleMoreAction}
        onClose={() => setMorePost(null)}
        post={morePost}
        showingAlt={morePost ? altVisibleIds.has(morePost.id) : false}
      />
    </View>
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
  pullWrap: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 12,
    zIndex: 20,
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
