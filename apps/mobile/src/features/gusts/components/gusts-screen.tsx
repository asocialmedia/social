import { activeNetworkInterests } from "@asm/protocols/discovery";
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlatList } from "react-native";
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
import { FeedSourceMenu } from "@/features/feed/components/feed-source-menu";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreAction,
  MoreMenuEntry,
} from "@/features/feed/components/more-menu";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { viewBatcher } from "@/features/feed/lib/view-batcher";
import { useFeedSourceStore } from "@/features/feed/state/feed-source-store";
import {
  consumeFeedTop,
  subscribeFeedTopRequests,
} from "@/features/feed/state/feed-store";
import { resolveGustResumeTab } from "@/features/feed/state/tab-store";
import {
  useHomeTabMemoryReady,
  useTabStore,
} from "@/features/feed/state/tab-store-native";
import { useVideoCaptionsStore } from "@/features/feed/state/video-captions-store";
import { networkRequest } from "@/features/network/lib/network-api";
import { trackNetworkObservation } from "@/features/network/lib/network-learning";
import { externalShareUrl } from "@/features/network/lib/network-paths";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { haptic } from "@/lib/interaction/haptics";
import type { ViewToken } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { PROD_API_URL } from "@/lib/network/api-base";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { failedGustSources, showGustFeedError } from "../lib/gust-sources";
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
  gustPullIntent,
  gustSwipeTarget,
  pullDistance,
  pullTriggers,
  shouldFetchMore,
  shouldMountVideo,
} from "../lib/reel-gestures";
import { useGustMuteStore } from "../state/gust-mute-store";
import { useFollowingGustPreview } from "../state/use-following-gust-preview";
import { useGustsFeed } from "../state/use-gusts-feed";
import { GustCard } from "./gust-card";
import type { GustCardProps } from "./gust-card";
import { GustCardSkeleton } from "./gust-card-skeleton";
import {
  GustSourceRetries,
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

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type GustEngagementEvent = Parameters<
  NonNullable<GustCardProps["onRecommendationEvent"]>
>[0];

// One reel page. Memoised with post-scoped handlers bound here, so the
// screen can hand every row the same stable callbacks.
const GustReelRow = memo(
  ({
    onRecommendation,
    onToggleAltFor,
    ...card
  }: Omit<GustCardProps, "onRecommendationEvent" | "onToggleAlt"> & {
    onRecommendation: (post: FeedPost, event: GustEngagementEvent) => void;
    onToggleAltFor: (postId: string) => void;
  }) => {
    const { pageHeight, post } = card;
    return (
      <View style={{ height: pageHeight }}>
        <GustCard
          {...card}
          onRecommendationEvent={(event) => onRecommendation(post, event)}
          onToggleAlt={() => onToggleAltFor(post.id)}
        />
      </View>
    );
  }
);
GustReelRow.displayName = "GustReelRow";

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
  if (!post.moderated && !post.external) {
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
  const network = useNetworkSettings();
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
    focused && (tab !== "following" || posts.length === 0)
  );
  const orderedFollowingAvatars = followingGustAvatars(
    tab === "following" ? posts : (followingPreview.data?.posts ?? []),
    tab === "following" ? activeIndex : 0
  );
  const followingAvatars = orderedFollowingAvatars.length
    ? orderedFollowingAvatars
    : followingPreview.fallbackAvatars;
  const headerScroll = useSharedValue({ anchor: 0, visible: true });
  const headerVisibility = useSharedValue(1);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerVisibility.get(),
    pointerEvents: headerScroll.get().visible ? "box-none" : "none",
    transform: [{ translateY: -16 * (1 - headerVisibility.get()) }],
  }));
  const pull = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const swipeOrigin = useSharedValue(0);
  const pullBaseline = useSharedValue<number | null>(null);
  const pullOrigin = useSharedValue({ x: 0, y: 0 });
  const refreshing = useSharedValue(false);
  const eddiePreviewProgress = useSharedValue(0);
  // The gust whose eddies sheet is open. Bluesky gusts open it too, showing
  // the asocialmedia discussion in-reel like web's GustsCommentsDrawer.
  const [eddiesPost, setEddiesPost] = useState<FeedPost | null>(null);
  const eddiesPostId = eddiesPost?.id ?? null;
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
  const settleSwipeRef = useRef<
    (origin: number, translation: number, velocity: number) => void
  >(() => {
    // Replaced once the page height and sheet state are known.
  });
  useEffect(() => {
    settleSwipeRef.current = (origin, translation, velocity) => {
      if (eddiesPostId !== null) {
        return;
      }
      const offset = gustSwipeTarget({
        origin,
        pageHeight,
        total: posts.length,
        translation,
        velocity,
      });
      if (offset !== null) {
        listRef.current?.scrollToOffset({ animated: true, offset });
      }
    };
  }, [eddiesPostId, pageHeight, posts.length]);
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

  // Dock reselect (web's reselectFeedNavigation on /gusts): tapping the Gusts
  // tab while already there scrolls the reel list back to the top.
  useEffect(
    () =>
      subscribeFeedTopRequests(() => {
        if (!consumeFeedTop("gusts")) {
          return;
        }
        listRef.current?.scrollToOffset({ animated: true, offset: 0 });
      }),
    []
  );

  // Keep the active index inside the list when it shrinks (a hide).
  const safeIndex = Math.min(activeIndex, Math.max(0, posts.length - 1));
  const activePost = posts[safeIndex] ?? null;
  const activeId = activePost?.id ?? null;

  // Near the end, the next page loads (web's 200px sentinel).
  useEffect(() => {
    if (
      shouldFetchMore({
        activeIndex: safeIndex,
        // A source whose last page failed waits for its own retry (web's
        // canFetchNextPage), so it is not re-requested on every render.
        hasNextPage: feed.canFetchNextPage,
        isFetching: feed.fetchingNext,
        total: posts.length,
      })
    ) {
      void feed.fetchNext();
    }
  }, [feed, posts.length, safeIndex]);

  // Signals for the active gust: views, history, recommendation dwell.
  const queueRef = useRef<RecommendationQueue | null>(null);

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
    return () => {
      void queue.flush();
      queueRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeId || activeId.startsWith("at://") || !focused) {
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
    // Web's reselect: tapping the tab you are on returns to its first gust
    // and brings the header back, instead of doing nothing.
    if (next === tab && !initialId) {
      headerScroll.set({ anchor: 0, visible: true });
      headerVisibility.set(withTiming(1, { duration: 180 }));
      if (safeIndex > 0) {
        haptic("selection");
        listRef.current?.scrollToOffset({ animated: true, offset: 0 });
      }
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

  // Web's showNewGusts: near the top the reel jumps to the newest clip; deep
  // in the reel the clip being watched keeps playing in its new slot and the
  // fresh clips wait above it, one swipe up.
  const prependAnchor = useRef<string | null>(null);
  const showNew = () => {
    const watched = posts[safeIndex];
    feed.showNewItems();
    if (safeIndex > 1 && watched) {
      prependAnchor.current = watched.id;
      return;
    }
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  };
  useEffect(() => {
    const anchor = prependAnchor.current;
    if (!anchor || pageHeight <= 0) {
      return;
    }
    const index = posts.findIndex((post) => post.id === anchor);
    if (index === -1) {
      return;
    }
    prependAnchor.current = null;
    // oxlint-disable-next-line react/set-state-in-effect -- the prepended page moved the watched gust; follow it to its new slot
    setActiveIndex(index);
    listRef.current?.scrollToOffset({
      animated: false,
      offset: index * pageHeight,
    });
  }, [pageHeight, posts]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const hidePost = (post: FeedPost) => {
    if (post.external) {
      const payload = {
        authorId: post.external.author.id,
        postId: post.id,
        scope: "post",
      };
      // Web's useExternalFeedback (2a8dc6ce): the gust leaves the reel at
      // once, the save runs behind it, and a failure puts it back. There is
      // no Undo: the preference is a POST only.
      const viewer = viewerId ?? "guest";
      const key = `post:${post.id}`;
      const store = useFeedSourceStore.getState();
      const wasHidden = store.excluded[viewer]?.has(key) ?? false;
      store.exclude(viewer, key, true);
      const saveFeedback = async () => {
        try {
          if (viewerId) {
            await networkRequest("/api/protocols/bluesky/feedback", {
              body: JSON.stringify(payload),
              method: "POST",
            });
          }
          trackNetworkObservation(viewer, post, "NOT_INTERESTED");
          toast({
            description: viewerId
              ? "Saved to your asocialmedia feed preferences."
              : "Saved for this session.",
            title: "Not interested",
          });
        } catch {
          useFeedSourceStore.getState().exclude(viewer, key, wasHidden);
          toast({
            title: "Couldn't save preference. Please try again.",
            variant: "destructive",
          });
        }
      };
      void saveFeedback();
      return;
    }
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
  const settlePageSwipe = useCallback(
    (origin: number, translation: number, velocity: number) => {
      settleSwipeRef.current(origin, translation, velocity);
    },
    []
  );
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
    const nativeScroll = Gesture.Native()
      .disallowInterruption(true)
      .onTouchesDown((event, manager) => {
        // Cancel the native drag as soon as a second finger starts a pinch.
        if (event.numberOfTouches > 1) {
          manager.fail();
        }
      });
    const pan = Gesture.Pan()
      .manualActivation(true)
      .simultaneousWithExternalGesture(nativeScroll)
      .onTouchesDown((event, manager) => {
        const [touch] = event.allTouches;
        if (
          !touch ||
          gustPullIntent({
            offset: scrollOffset.get(),
            refreshing: refreshing.get(),
            touches: event.numberOfTouches,
            x: 0,
            y: 0,
          }) === "fail"
        ) {
          manager.fail();
          return;
        }
        pullOrigin.set({ x: touch.absoluteX, y: touch.absoluteY });
      })
      .onTouchesMove((event, manager) => {
        const [touch] = event.allTouches;
        if (!touch) {
          manager.fail();
          return;
        }
        const origin = pullOrigin.get();
        const intent = gustPullIntent({
          offset: scrollOffset.get(),
          refreshing: refreshing.get(),
          touches: event.numberOfTouches,
          x: touch.absoluteX - origin.x,
          y: touch.absoluteY - origin.y,
        });
        if (intent === "fail") {
          manager.fail();
        } else if (intent === "activate") {
          manager.activate();
        }
      })
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
    const pageSwipe = Gesture.Pan()
      .activeOffsetY([-12, 12])
      .failOffsetX([-24, 24])
      .maxPointers(1)
      .simultaneousWithExternalGesture(nativeScroll, pan)
      .onTouchesDown((event, manager) => {
        if (event.numberOfTouches > 1) {
          manager.fail();
          return;
        }
        swipeOrigin.set(scrollOffset.get());
      })
      .onEnd((event, success) => {
        if (success) {
          scheduleOnRN(
            settlePageSwipe,
            swipeOrigin.get(),
            event.translationY,
            event.velocityY
          );
        }
      });
    return { nativeScroll, pageSwipe, pan };
  });

  // Every handler a card receives is stable, so a swipe re-renders only the
  // rows whose active or mounted state actually flipped (GustReelRow is
  // memoised); the other mounted cards and their players stay untouched.
  const handleRecommendation = useCallback(
    (post: FeedPost, event: GustEngagementEvent) => {
      if (post.external) {
        trackNetworkObservation(
          viewerId ?? "guest",
          post,
          event.eventType,
          event.durationMs
        );
        return;
      }
      queueRef.current?.push(
        event.eventType,
        post.id,
        event.durationMs,
        undefined,
        post.recommendation?.requestId
      );
    },
    [viewerId]
  );
  const toggleAltFor = useCallback((postId: string) => {
    setAltVisibleIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);
  const closeTranscript = useCallback(() => setTranscriptPostId(null), []);
  const openMore = useCallback(
    (post: FeedPost, anchor: MenuAnchor) => setMoreTarget({ anchor, post }),
    []
  );
  const openEddies = useCallback((post: FeedPost) => setEddiesPost(post), []);
  const openShare = useCallback((post: FeedPost) => setSharePost(post), []);
  const pagerGestures = useMemo(
    () => [gestures.nativeScroll, gestures.pan, gestures.pageSwipe],
    [gestures]
  );

  const renderItem = useCallback(
    ({ index, item }: { index: number; item: FeedPost }) => (
      <GustReelRow
        apiBase={apiBase}
        captionsOn={captionsOn}
        eddiesOpen={eddiesPostId === item.id}
        isActive={index === safeIndex}
        mountVideo={shouldMountVideo(index, safeIndex)}
        onCloseTranscript={closeTranscript}
        onMore={openMore}
        onOpenEddies={openEddies}
        onRecommendation={handleRecommendation}
        onShare={openShare}
        onToggleAltFor={toggleAltFor}
        pageHeight={pageHeight}
        pagerGestures={pagerGestures}
        post={item}
        previewProgress={eddiePreviewProgress}
        showAlt={altVisibleIds.has(item.id)}
        suspended={!focused}
        transcriptOpen={transcriptPostId === item.id}
        viewerId={viewerId}
      />
    ),
    [
      altVisibleIds,
      apiBase,
      captionsOn,
      closeTranscript,
      eddiePreviewProgress,
      eddiesPostId,
      focused,
      handleRecommendation,
      openEddies,
      openMore,
      openShare,
      pageHeight,
      pagerGestures,
      safeIndex,
      toggleAltFor,
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

  const feedError =
    feed.status === "error" ||
    showGustFeedError({
      canFetchNextPage: feed.canFetchNextPage,
      pageError: feed.pageError,
      postCount: posts.length,
      status: feed.status,
    });
  const loading =
    !feedError &&
    (feed.status === "loading" ||
      (feed.status === "ready" && posts.length === 0 && feed.canFetchNextPage));
  const empty =
    feed.status === "ready" && posts.length === 0 && !loading && !feedError;
  // Web renders GustSourceRetries in the reel's last slot; native floats it
  // under the header once the viewer reaches the last loaded gust.
  const endRetries =
    posts.length > 0 &&
    safeIndex >= posts.length - 1 &&
    !feed.fetchingNext &&
    failedGustSources(feed.sources).length > 0;
  const chromeTop = insets.top + 16;

  let body;
  if (gatedPersonalized) {
    body = (
      <GustsEmpty mode="auth" onAction={() => router.push("/(auth)/login")} />
    );
  } else if (feedError) {
    body = (
      <GustsEmpty mode="error" onAction={() => feed.retry()}>
        <GustSourceRetries sources={feed.sources} tone="panel" />
      </GustsEmpty>
    );
  } else if (loading) {
    body = <GustCardSkeleton />;
  } else if (empty) {
    // Web's focused copy: an empty discovery reel while the active network
    // profile carries interests means the profile filtered everything out.
    const profileFiltered =
      tab !== "following" &&
      !initialId &&
      activeNetworkInterests(network.settings.preferences).length > 0;
    body = (
      <GustsEmpty
        mode={profileFiltered ? "focused" : "empty"}
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
      <GestureDetector gesture={gestures.pageSwipe}>
        <GestureDetector gesture={gestures.pan}>
          <GestureDetector gesture={gestures.nativeScroll}>
            <Animated.FlatList
              data={posts}
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
              pagingEnabled
              ref={listRef}
              removeClippedSubviews
              renderItem={renderItem}
              scrollEnabled={eddiesPostId === null}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
              viewabilityConfig={VIEWABILITY}
              windowSize={5}
            />
          </GestureDetector>
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
                  avatars={followingAvatars}
                  onChange={changeTab}
                />
              ) : (
                <GustTabs active={tab} onChange={changeTab} />
              )}
            </View>
            {/* Web's 2.5rem side column, matching the back button's width. */}
            <View style={styles.backBalance}>
              <FeedSourceMenu following={tab === "following"} />
            </View>
          </Animated.View>

          {(feed.newItems.length > 0 && !initialId) || endRetries ? (
            <View
              pointerEvents="box-none"
              style={[styles.pillRow, { top: insets.top + 64 }]}
            >
              {feed.newItems.length > 0 && !initialId ? (
                <NewGustsPill
                  apiBase={apiBase}
                  items={feed.newItems}
                  onPress={showNew}
                />
              ) : null}
              {endRetries ? (
                <GustSourceRetries sources={feed.sources} tone="video" />
              ) : null}
            </View>
          ) : null}

          {feed.fetchingNext && safeIndex >= posts.length - 1 ? (
            <PagingSpinner />
          ) : null}
        </>
      ) : null}
      <GustEddiesSheet
        external={eddiesPost?.external ?? null}
        previewProgress={eddiePreviewProgress}
        viewportHeight={pageHeight}
        onClose={() => setEddiesPost(null)}
        postId={eddiesPostId}
        viewerId={viewerId ?? undefined}
      />
      <ShareSheet
        description="Share this gust with your network"
        onClose={() => setSharePost(null)}
        post={sharePost}
        shareUrl={(post) =>
          post.external
            ? externalShareUrl(post.id)
            : gustShareUrl(PROD_API_URL, post.id)
        }
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
  backBalance: { alignItems: "center", justifyContent: "center", width: 40 },
  controls: { alignItems: "center", flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    height: 44,
    left: 16,
    position: "absolute",
    right: 16,
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
