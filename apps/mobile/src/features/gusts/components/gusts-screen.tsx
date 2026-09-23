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
  Search,
  Speech,
  Subtitles,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewToken } from "react-native";
import { FlatList, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { useVideoCaptionsStore } from "@/features/feed/state/video-captions-store";
import { PROD_API_URL } from "@/lib/api-base";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { GustViewSession } from "../lib/gust-view-session";
import {
  defaultGustTab,
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
  const tab = tabChoice ?? defaultGustTab(Boolean(viewerId));
  const feed = useGustsFeed({
    enabled: !isPending,
    initialId,
    tab,
    userId: viewerId,
  });
  const { posts } = feed;

  const [pageHeight, setPageHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(true);
  const [pull, setPull] = useState(0);
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
  const scrollOffsetRef = useRef(0);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
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
    refreshingRef.current = feed.refreshing;
    refreshRef.current = () => {
      void feed.refresh();
    };
  }, [feed]);

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
      viewBatcher.mark(activeId, { apiBase, cookie });
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
    logInfo("gusts.tab_changed", { tab: next });
    setTabChoice(next);
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

  // Pull to refresh at the top of the reel, on gesture-handler so the
  // native pager's scroll never cancels it.
  // oxlint-disable-next-line react/hook-use-state, react/refs -- single stable gesture pair created once; no setter is ever needed and no ref value is read here
  const [gestures] = useState(() => {
    let baseline: number | null = null;
    const reset = () => {
      baseline = null;
      pullRef.current = 0;
      setPull(0);
    };
    const nativeScroll = Gesture.Native();
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetY(PULL_CAPTURE_SLOP)
      .failOffsetX([-PULL_CAPTURE_SLOP * 2, PULL_CAPTURE_SLOP * 2])
      .simultaneousWithExternalGesture(nativeScroll)
      .onUpdate((event) => {
        if (refreshingRef.current || scrollOffsetRef.current > 0) {
          if (pullRef.current > 0) {
            reset();
          }
          return;
        }
        if (baseline === null) {
          baseline = event.translationY;
        }
        const distance = pullDistance(event.translationY - baseline);
        if (Math.abs(distance - pullRef.current) > 1) {
          pullRef.current = distance;
          setPull(distance);
        }
      })
      .onFinalize(() => {
        if (!refreshingRef.current && pullTriggers(pullRef.current)) {
          refreshRef.current();
        }
        reset();
      });
    return { nativeScroll, pan };
  });

  const renderItem = useCallback(
    ({ index, item }: { index: number; item: FeedPost }) => (
      <View style={{ height: pageHeight }}>
        <GustCard
          apiBase={apiBase}
          captionsOn={captionsOn}
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
      focused,
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
  if (loading) {
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
          <FlatList
            data={posts}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              index,
              length: pageHeight,
              offset: pageHeight * index,
            })}
            initialNumToRender={2}
            keyExtractor={(item) => item.id}
            maxToRenderPerBatch={3}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            onViewableItemsChanged={onViewableItemsChanged}
            overScrollMode="never"
            pagingEnabled
            ref={listRef}
            removeClippedSubviews
            renderItem={renderItem}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            snapToInterval={pageHeight}
            viewabilityConfig={VIEWABILITY}
            windowSize={5}
          />
        </GestureDetector>
      </GestureDetector>
    );
  }

  const panelBg = isDark ? "#171717" : "#f3f4f6";
  const onVideo = posts.length > 0 || loading;

  return (
    <View
      onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}
      style={[styles.root, { backgroundColor: onVideo ? "#000000" : panelBg }]}
    >
      <StatusBar style={onVideo || isDark ? "light" : "dark"} />
      {body}

      <PullIndicator
        distance={pull}
        refreshing={feed.refreshing}
        top={insets.top + 56}
      />

      <View
        pointerEvents="box-none"
        style={[styles.tabsRow, { top: chromeTop }]}
      >
        <GustTabs active={tab} onChange={changeTab} />
      </View>
      <RailButton
        accessibilityLabel="Go back"
        onPress={goBack}
        size={40}
        style={[styles.back, { top: chromeTop }]}
      >
        <ChevronLeft color={RAIL_ICON_COLOR} size={20} />
      </RailButton>
      {/* Web opens Spotlight search; native has no search screen yet, so
          the button holds its place disabled, like the dock's stubs. */}
      <RailButton
        accessibilityLabel="Search"
        disabled
        size={40}
        style={[styles.search, { top: chromeTop }]}
      >
        <Search color={RAIL_ICON_COLOR} size={20} />
      </RailButton>

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

      <GustEddiesSheet
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
  back: {
    left: 16,
    position: "absolute",
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
  search: {
    position: "absolute",
    right: 16,
    zIndex: 30,
  },
  tabsRow: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
});
