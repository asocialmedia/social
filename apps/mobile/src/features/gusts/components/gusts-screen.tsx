import {
  advanceGustHeader,
  followingGustAvatars,
} from "@asm/ui/lib/gust-header";
import { NavigationBar } from "expo-navigation-bar";
// The Gusts reel: a 1:1 native port of web's /gusts page (client-gusts.tsx)
// at phone size. A full-screen vertical pager snaps one gust per screen;
// the gust at least 60% on screen is active and plays, its neighbours mount
// a paused player, everything else is poster-only. Chrome floats above:
// back, the Latest / For you tabs, search, the new-gusts pill and the pull
// spinner. The dock is intentionally absent (web's immersive routes).
//
// URL contract (web's): ?id=<full post id> deep-links a gust (always
// chronological), ?tab=latest|personalized picks the tab, ?create=true
// opens the composer in gust mode. Signals: views batch while active, a
// history visit per active gust, and recommendation events (impression,
// view start/complete, dwell) for signed-in viewers.
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Captions,
  ChevronLeft,
  EyeOff,
  Speech,
  Subtitles,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlatList, ViewToken } from "react-native";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreAction,
  MoreMenuEntry,
} from "@/features/feed/components/more-menu";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { viewBatcher } from "@/features/feed/lib/view-batcher";
import { resolveGustResumeTab } from "@/features/feed/state/tab-store";
import {
  useHomeTabMemoryReady,
  useTabStore,
} from "@/features/feed/state/tab-store-native";
import { useVideoCaptionsStore } from "@/features/feed/state/video-captions-store";
import { PROD_API_URL } from "@/lib/api-base";
import { getApiBaseUrl } from "@/lib/api-env";
import { haptic } from "@/lib/haptics";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { logInfo, logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { GustViewSession } from "../lib/gust-view-session";
import {
  gustShareUrl,
  markPostVisited,
  parseGustTab,
  setNotInterested,
  submitRecommendationEvents,
} from "../lib/gusts-api";
import type { GustTab } from "../lib/gusts-api";
import { RecommendationQueue } from "../lib/recommendation-tracker";
import {
  pullDistance,
  pullTriggers,
  shouldFetchMore,
  shouldMountVideo,
} from "../lib/reel-gestures";
import { useGustMuteStore } from "../state/gust-mute-store";
import { useFollowingGustPreview } from "../state/use-following-gust-preview";
import { useGustsFeed } from "../state/use-gusts-feed";
import { GustCard } from "./gust-card";
import { GustCardSkeleton } from "./gust-card-skeleton";
import {
  GustsEmpty,
  GustTabs,
  NewGustsPill,
  PagingSpinner,
  PullIndicator,
} from "./gust-chrome";
import { GustEddiesSheet } from "./gust-eddies-sheet";
import { GustFeedControls } from "./gust-feed-controls";
import { RAIL_ICON_COLOR, RailButton } from "./rail-button";

const VIEWABILITY = { itemVisiblePercentThreshold: 60 };
const PULL_CAPTURE_SLOP = 12;

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Web's gust More menu, in order: the per-card captions and transcript
// toggles (hidden when moderated), Not interested (signed in, not the
// author), and Show / Hide alt. Web lists captions twice; once is enough.
function gustMoreEntries(options: {
  captionsOn: boolean;
  post: FeedPost;
  showingAlt: boolean;
  transcriptOpen: boolean;
  viewerId: string | null;
}): MoreMenuEntry[] {
  const { captionsOn, post, showingAlt, transcriptOpen, viewerId } = options;
  const entries: MoreMenuEntry[] = [];
  if (!post.moderated) {
    entries.push(
      {
        action: { type: "toggle-captions" },
        icon: Subtitles,
        label: captionsOn ? "Hide captions" : "Show captions",
      },
      {
        action: { type: "toggle-transcript" },
        icon: Speech,
        label: transcriptOpen ? "Hide transcript" : "View transcript",
      }
    );
  }
  if (viewerId && viewerId !== post.user?.id) {
    entries.push({
      action: { type: "hide" },
      icon: EyeOff,
      label: "Not interested",
    });
  }
  if ((post.attachments ?? []).some((media) => media?.altText)) {
    entries.push({
      action: { type: "toggle-alt" },
      icon: Captions,
      label: showingAlt ? "Hide alt" : "Show alt",
    });
  }
  return entries;
}

export function GustsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();
  const params = useLocalSearchParams<{
    create?: string;
    id?: string;
    tab?: string;
  }>();
  const { isPending, user } = useSessionContext();
  const viewerId = user?.id ?? null;
  const apiBase = getApiBaseUrl();
  const openComposer = useComposerStore((state) => state.open);
  const hydrateMute = useGustMuteStore((state) => state.hydrate);
  const captionsOn = useVideoCaptionsStore((state) => state.showCaptions);
  const toggleCaptions = useVideoCaptionsStore((state) => state.toggleCaptions);

  const [initialId, setInitialId] = useState(() => firstParam(params.id));
  const [tabChoice, setTabChoice] = useState<GustTab | null>(() =>
    parseGustTab(firstParam(params.tab))
  );
  const memoryReady = useHomeTabMemoryReady();
  const storedGust = useTabStore((state) =>
    viewerId ? state.gustByUserId[viewerId] : undefined
  );
  const setGustTab = useTabStore((state) => state.setGustTab);
  const tab =
    tabChoice ??
    resolveGustResumeTab(
      firstParam(params.tab),
      Boolean(viewerId),
      storedGust,
      memoryReady
    );
  // For you is ranked from the viewer's own watch/amplify signals, so it is
  // account-only. A guest who taps the tab (or follows a deep link) gets a
  // sign-in prompt instead of a feed, and nothing is fetched. A ?id= deep link
  // is always chronological, so it stays viewable by guests.
  const gatedPersonalized = tab !== "latest" && !viewerId && !initialId;
  const feed = useGustsFeed({
    enabled: !isPending && !gatedPersonalized,
    initialId,
    tab,
    userId: viewerId,
  });
  const { posts } = feed;

  const [pageHeight, setPageHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(true);
  const followingPreview = useFollowingGustPreview(
    viewerId,
    tab !== "following" && focused
  );
  const followingAvatars = followingGustAvatars(
    tab === "following" ? posts : (followingPreview.data?.posts ?? []),
    tab === "following" ? activeIndex : 0
  );
  const headerScroll = useSharedValue({ anchor: 0, visible: true });
  const headerVisibility = useSharedValue(1);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerVisibility.get(),
    pointerEvents: headerScroll.get().visible ? "box-none" : "none",
    transform: [{ translateY: -16 * (1 - headerVisibility.get()) }],
  }));
  const pull = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const pullBaseline = useSharedValue<number | null>(null);
  const refreshing = useSharedValue(false);
  const eddiePreviewProgress = useSharedValue(0);
  const [eddiesPostId, setEddiesPostId] = useState<string | null>(null);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [moreTarget, setMoreTarget] = useState<{
    anchor: MenuAnchor;
    post: FeedPost;
  } | null>(null);
  const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [transcriptPostId, setTranscriptPostId] = useState<string | null>(null);
  const listRef = useRef<FlatList<FeedPost>>(null);
  const refreshRef = useRef<() => void>(() => {
    // Replaced once the feed hook is ready.
  });
  const createHandledRef = useRef(false);

  useEffect(() => {
    void hydrateMute();
  }, [hydrateMute]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  // ?create=true opens the composer in gust mode (guests log in first).
  useEffect(() => {
    if (createHandledRef.current || isPending || params.create !== "true") {
      return;
    }
    createHandledRef.current = true;
    if (viewerId) {
      openComposer("gust");
    } else {
      router.push("/(auth)/login");
    }
  }, [isPending, openComposer, params.create, router, viewerId]);

  useEffect(() => {
    refreshing.set(feed.refreshing);
    refreshRef.current = () => {
      void feed.refresh();
    };
  }, [feed, refreshing]);

  // Keep the active index inside the list when it shrinks (a hide).
  const safeIndex = Math.min(activeIndex, Math.max(0, posts.length - 1));
  const activePost = posts[safeIndex] ?? null;
  const activeId = activePost?.id ?? null;

  // Near the end, the next page loads (web's 200px sentinel).
  useEffect(() => {
    if (
      shouldFetchMore({
        activeIndex: safeIndex,
        hasNextPage: feed.hasNextPage,
        isFetching: feed.fetchingNext,
        total: posts.length,
      })
    ) {
      void feed.fetchNext();
    }
  }, [feed, posts.length, safeIndex]);

  // Signals for the active gust: views, history, recommendation dwell.
  const queueRef = useRef<RecommendationQueue | null>(null);
  const sessionsRef = useRef(new Map<string, GustViewSession>());
  useEffect(() => {
    const queue = new RecommendationQueue(async (events) => {
      try {
        await submitRecommendationEvents(events, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
      } catch (error) {
        logWarn("gusts.signals_failed", { reason: reason(error) });
        throw error;
      }
    });
    queueRef.current = queue;
    const sessions = sessionsRef.current;
    return () => {
      for (const session of sessions.values()) {
        session.stop();
      }
      sessions.clear();
      void queue.flush();
      queueRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeId || !focused) {
      return;
    }
    void (async () => {
      const cookie = await authClient.getCookie();
      viewBatcher.mark(activeId, { apiBase, getCookie: authClient.getCookie });
      if (!viewerId) {
        return;
      }
      try {
        await markPostVisited(activeId, { apiBase, cookie });
      } catch (error) {
        logWarn("gusts.visit_failed", { reason: reason(error) });
      }
    })();
    const queue = queueRef.current;
    if (!viewerId || !queue) {
      return;
    }
    let session = sessionsRef.current.get(activeId);
    if (!session) {
      session = new GustViewSession(activeId, queue);
      sessionsRef.current.set(activeId, session);
    }
    session.start();
    const current = session;
    return () => current.stop();
  }, [activeId, apiBase, focused, viewerId]);

  // The transcript belongs to one card; paging away closes it.
  useEffect(() => {
    if (transcriptPostId && transcriptPostId !== activeId) {
      // oxlint-disable-next-line react/set-state-in-effect -- paging away from the gust closes its transcript drawer
      setTranscriptPostId(null);
    }
  }, [activeId, transcriptPostId]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedPost>[] }) => {
      const first = viewableItems.find((item) => item.isViewable);
      if (first?.index !== null && first?.index !== undefined) {
        setActiveIndex(first.index);
      }
    },
    []
  );

  const changeTab = (next: GustTab) => {
    if (next === tab && !initialId) {
      return;
    }
    haptic("selection");
    headerScroll.set({ anchor: 0, visible: true });
    headerVisibility.set(withTiming(1, { duration: 180 }));
    logInfo("gusts.tab_changed", { tab: next });
    setTabChoice(next);
    if (viewerId) {
      setGustTab(viewerId, next);
    }
    setInitialId(null);
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  };

  const showNew = () => {
    feed.showNewItems();
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const hidePost = (post: FeedPost) => {
    feed.hide(post.id);
    logInfo("gusts.not_interested", {});
    void (async () => {
      try {
        await setNotInterested(post.id, true, {
          apiBase,
          cookie: await authClient.getCookie(),
        });
      } catch (error) {
        logWarn("gusts.not_interested_failed", { reason: reason(error) });
      }
    })();
    toast({
      button: {
        onClick: () => {
          feed.unhide(post.id);
          void (async () => {
            try {
              await setNotInterested(post.id, false, {
                apiBase,
                cookie: await authClient.getCookie(),
              });
            } catch (error) {
              logWarn("gusts.undo_not_interested_failed", {
                reason: reason(error),
              });
            }
          })();
        },
        title: "Undo",
      },
      description: "You'll see fewer posts like this.",
      duration: 6000,
      title: "Not interested",
    });
  };

  const handleMoreAction = (action: MoreAction) => {
    const post = moreTarget?.post;
    if (!post) {
      return;
    }
    if (action.type === "toggle-captions") {
      toggleCaptions();
    } else if (action.type === "toggle-transcript") {
      setTranscriptPostId((current) => (current === post.id ? null : post.id));
    } else if (action.type === "hide") {
      hidePost(post);
    } else if (action.type === "toggle-alt") {
      setAltVisibleIds((current) => {
        const next = new Set(current);
        if (next.has(post.id)) {
          next.delete(post.id);
        } else {
          next.add(post.id);
        }
        return next;
      });
    }
  };

  const refreshFromPull = useCallback(() => refreshRef.current(), []);
  const onScroll = useAnimatedScrollHandler((event) => {
    const offset = event.contentOffset.y;
    scrollOffset.set(offset);
    const previous = headerScroll.get();
    const next = advanceGustHeader(offset, previous);
    headerScroll.set(next);
    if (previous.visible !== next.visible) {
      headerVisibility.set(withTiming(next.visible ? 1 : 0, { duration: 180 }));
    }
  });
  // The pager and pull feedback never enter React or the JS runtime during a drag.
  // oxlint-disable-next-line react/hook-use-state, react/refs -- the gesture retains a callback and only invokes its ref on release; only shared values change during recognition
  const [gestures] = useState(() => {
    const nativeScroll = Gesture.Native();
    const pan = Gesture.Pan()
      .activeOffsetY(PULL_CAPTURE_SLOP)
      .failOffsetX([-PULL_CAPTURE_SLOP * 2, PULL_CAPTURE_SLOP * 2])
      .simultaneousWithExternalGesture(nativeScroll)
      .onBegin(() => pullBaseline.set(null))
      .onUpdate((event) => {
        if (refreshing.get() || scrollOffset.get() > 1) {
          pull.set(0);
          return;
        }
        if (pullBaseline.get() === null) {
          pullBaseline.set(event.translationY);
        }
        pull.set(
          pullDistance(
            event.translationY - (pullBaseline.get() ?? event.translationY)
          )
        );
      })
      .onFinalize(() => {
        if (!refreshing.get() && pullTriggers(pull.get())) {
          scheduleOnRN(refreshFromPull);
        }
        pull.set(withTiming(0, { duration: 150 }));
        pullBaseline.set(null);
      });
    return { nativeScroll, pan };
  });

  const renderItem = useCallback(
    ({ index, item }: { index: number; item: FeedPost }) => (
      <View style={{ height: pageHeight }}>
        <GustCard
          apiBase={apiBase}
          captionsOn={captionsOn}
          eddiesOpen={eddiesPostId === item.id}
          previewProgress={eddiePreviewProgress}
          pageHeight={pageHeight}
          pagerGestures={[gestures.nativeScroll, gestures.pan]}
          isActive={index === safeIndex}
          mountVideo={shouldMountVideo(index, safeIndex)}
          onCloseTranscript={() => setTranscriptPostId(null)}
          onMore={(post, anchor) => setMoreTarget({ anchor, post })}
          onOpenEddies={(post) => setEddiesPostId(post.id)}
          onShare={(post) => setSharePost(post)}
          onToggleAlt={() =>
            setAltVisibleIds((current) => {
              const next = new Set(current);
              if (next.has(item.id)) {
                next.delete(item.id);
              } else {
                next.add(item.id);
              }
              return next;
            })
          }
          post={item}
          showAlt={altVisibleIds.has(item.id)}
          suspended={!focused}
          transcriptOpen={transcriptPostId === item.id}
          viewerId={viewerId}
        />
      </View>
    ),
    [
      altVisibleIds,
      apiBase,
      captionsOn,
      eddiePreviewProgress,
      eddiesPostId,
      focused,
      gestures,
      pageHeight,
      safeIndex,
      transcriptPostId,
      viewerId,
    ]
  );

  const moreEntries = useMemo(
    () =>
      moreTarget
        ? gustMoreEntries({
            captionsOn,
            post: moreTarget.post,
            showingAlt: altVisibleIds.has(moreTarget.post.id),
            transcriptOpen: transcriptPostId === moreTarget.post.id,
            viewerId,
          })
        : [],
    [altVisibleIds, captionsOn, moreTarget, transcriptPostId, viewerId]
  );

  const loading =
    feed.status === "loading" ||
    (feed.status === "ready" && posts.length === 0 && feed.hasNextPage);
  const empty = feed.status === "ready" && posts.length === 0 && !loading;
  const chromeTop = insets.top + 16;

  let body;
  if (gatedPersonalized) {
    body = (
      <GustsEmpty mode="auth" onAction={() => router.push("/(auth)/login")} />
    );
  } else if (loading) {
    body = <GustCardSkeleton />;
  } else if (feed.status === "error") {
    body = <GustsEmpty mode="error" onAction={() => feed.retry()} />;
  } else if (empty) {
    body = (
      <GustsEmpty
        mode="empty"
        onAction={() => {
          if (viewerId) {
            openComposer("gust");
          } else {
            router.push("/(auth)/login");
          }
        }}
      />
    );
  } else if (pageHeight > 0) {
    body = (
      <GestureDetector gesture={gestures.pan}>
        <GestureDetector gesture={gestures.nativeScroll}>
          <Animated.FlatList
            data={posts}
            decelerationRate={0.985}
            disableIntervalMomentum
            getItemLayout={(_, index) => ({
              index,
              length: pageHeight,
              offset: pageHeight * index,
            })}
            initialNumToRender={2}
            keyExtractor={(item) => item.id}
            maxToRenderPerBatch={3}
            onMomentumScrollEnd={(event) => {
              if (pageHeight > 0) {
                const nextIndex = Math.round(
                  event.nativeEvent.contentOffset.y / pageHeight
                );
                if (
                  nextIndex >= 0 &&
                  nextIndex < posts.length &&
                  nextIndex !== activeIndex
                ) {
                  setActiveIndex(nextIndex);
                }
              }
            }}
            onScroll={onScroll}
            onViewableItemsChanged={onViewableItemsChanged}
            overScrollMode="never"
            ref={listRef}
            removeClippedSubviews
            renderItem={renderItem}
            scrollEnabled={eddiesPostId === null}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
            snapToAlignment="start"
            snapToInterval={pageHeight}
            viewabilityConfig={VIEWABILITY}
            windowSize={5}
          />
        </GestureDetector>
      </GestureDetector>
    );
  }

  const panelBg = isDark ? "#171717" : "#f3f4f6";
  // The sign-in prompt is a panel surface, not a video: keeping the reel's
  // black backdrop would render the themed prompt text invisible.
  const onVideo = !gatedPersonalized && (posts.length > 0 || loading);

  return (
    <View
      onLayout={(event) => {
        const height = Math.round(event.nativeEvent.layout.height);
        if (height > 0 && height !== pageHeight) {
          setPageHeight(height);
        }
      }}
      style={[styles.root, { backgroundColor: onVideo ? "#000000" : panelBg }]}
    >
      <StatusBar style={onVideo || isDark ? "light" : "dark"} />
      {focused ? <NavigationBar hidden /> : null}
      {body}

      {eddiesPostId === null ? (
        <>
          <PullIndicator
            distance={pull}
            refreshing={feed.refreshing}
            top={insets.top + 56}
          />

          <Animated.View
            style={[styles.header, { top: chromeTop }, headerStyle]}
          >
            <RailButton accessibilityLabel="Go back" onPress={goBack} size={40}>
              <ChevronLeft color={RAIL_ICON_COLOR} size={20} />
            </RailButton>
            <View style={styles.controls}>
              {viewerId ? (
                <GustFeedControls
                  active={tab}
                  apiBase={apiBase}
                  avatars={followingAvatars}
                  onChange={changeTab}
                />
              ) : (
                <GustTabs active={tab} onChange={changeTab} />
              )}
            </View>
          </Animated.View>

          {feed.newItems.length > 0 && !initialId ? (
            <View
              pointerEvents="box-none"
              style={[styles.pillRow, { top: insets.top + 64 }]}
            >
              <NewGustsPill
                apiBase={apiBase}
                items={feed.newItems}
                onPress={showNew}
              />
            </View>
          ) : null}

          {feed.fetchingNext && safeIndex >= posts.length - 1 ? (
            <PagingSpinner />
          ) : null}
        </>
      ) : null}
      <GustEddiesSheet
        previewProgress={eddiePreviewProgress}
        viewportHeight={pageHeight}
        onClose={() => setEddiesPostId(null)}
        postId={eddiesPostId}
        viewerId={viewerId ?? undefined}
      />
      <ShareSheet
        description="Share this gust with your network"
        onClose={() => setSharePost(null)}
        post={sharePost}
        shareUrl={(post) => gustShareUrl(PROD_API_URL, post.id)}
        title="Share Gust"
      />
      <MoreMenu
        anchor={moreTarget?.anchor ?? null}
        entries={moreEntries}
        onAction={handleMoreAction}
        onClose={() => setMoreTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { alignItems: "center", flex: 1, paddingRight: 16 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    left: 16,
    position: "absolute",
    right: 8,
    zIndex: 30,
  },
  pillRow: {
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
  root: {
    flex: 1,
  },
});
