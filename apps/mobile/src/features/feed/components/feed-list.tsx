// One tab's feed list: thread-grouped post cards in a FlatList with
// pull-refresh, infinite scroll, per-tab scroll memory (restores position
// when switching tabs, like web's useFeedScrollMemory), the new-content
// pill overlay, and loading/error/empty/end states mirroring web HomeFeed.
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ViewToken } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import errorImage from "@/assets/images/error.png";
import noFeedImage from "@/assets/images/nofeed.png";
import notFoundImage from "@/assets/images/notfound.png";
import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import type { FeedVariant } from "../lib/feed-api";
import { feedPrefetchUrls } from "../lib/feed-prefetch";
import { groupPostsIntoThreads, orderByIndex } from "../lib/feed-types";
import type { FeedPost, FeedThreadGroup } from "../lib/feed-types";
import {
  HEADER_BAR_HEIGHT,
  reportFeedScroll,
  resetHeaderScroll,
} from "../lib/header-visibility";
import { hasVideoAttachment } from "../lib/media-kind";
import { viewBatcher } from "../lib/view-batcher";
import { setAutoplayPostId, setVisiblePostIds } from "../lib/visible-posts";
import { consumeFeedTop, feedCache } from "../state/feed-store";
import { useFeedTab } from "../state/use-feed";
import { useVideoCaptionsStore } from "../state/video-captions-store";
import { FeedSkeleton, FeedSkeletonCard } from "./feed-skeleton";
import { buildMoreEntries, MoreMenu } from "./more-menu";
import type { MenuAnchor, MoreAction } from "./more-menu";
import { NewContentPill } from "./new-content-pill";
import type { PillAuthor } from "./new-content-pill";
import { PostCard } from "./post-card";
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
function feedGroupKey(group: FeedThreadGroup): string {
  return group.id;
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
  // Rendered as the list's own header, so it scrolls away with the content
  // and comes back on pull-down. Only the visible tab is given one: a header
  // per tab would mount a composer (a TextInput, an avatar, 3D surfaces) four
  // times over and remount on every switch. Typed as an element rather than a
  // bare ReactNode because that is all ListHeaderComponent accepts.
  header?: ReactElement | null;
  userId: string | undefined;
  variant: FeedVariant;
}

export function FeedList({
  active,
  bottomInset = 0,
  enabled,
  header,
  userId,
  variant,
}: FeedListProps) {
  const isActive = active ?? enabled;
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const listRef = useRef<FlatList<FeedThreadGroup>>(null);

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
  const toggleCaptions = useVideoCaptionsStore((state) => state.toggleCaptions);
  const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [lastDismissed, setLastDismissed] = useState<string | null>(null);
  const {
    dismissPost,
    fetchNext,
    hasMore,
    newItems,
    posts,
    refresh,
    showNewPosts,
    status,
    undoDismiss,
  } = useFeedTab({ enabled, userId, variant });

  const overflow = usePostOverflow({
    onDeleted: (postId) => {
      // A deleted post leaves the feed the same way a hidden one does, but
      // with no undo: there is nothing left to bring back.
      dismissPost(postId);
    },
    onHide: (post) => {
      dismissPost(post.id);
      setLastDismissed(post.id);
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
  const handleOpenMore = useCallback((target: FeedPost, anchor: MenuAnchor) => {
    setMoreTarget({ anchor, post: target });
  }, []);
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
  const memoryKey = `home:${variant}`;
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
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  }, [isActive, memoryKey, variant]);

  useEffect(() => {
    if (status !== "success" || posts.length === 0) {
      return;
    }
    if (jumpedToTop.current || restoredScroll.current) {
      return;
    }
    const offset = scrollMemory.get(memoryKey) ?? 0;
    if (offset > 0) {
      const timer = setTimeout(() => {
        restoredScroll.current = true;
        listRef.current?.scrollToOffset({ animated: false, offset });
      }, 60);
      return () => clearTimeout(timer);
    }
    restoredScroll.current = true;
    // Restore once after content arrives, never on pagination or refresh.
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
  // takes over hiding from there. Becoming active always publishes the
  // retained viewable ids (even when empty) so stale ids from the previous
  // tab cannot keep an off-screen video playing.
  useEffect(() => {
    enabledRef.current = isActive;
    if (isActive) {
      resetHeaderScroll();
      const stored = latestVisibleRef.current;
      setVisiblePostIds(stored);
      setAutoplayPostId(latestAutoplayRef.current);
      return () => {
        enabledRef.current = false;
        setVisiblePostIds(new Set());
        setAutoplayPostId(null);
      };
    }
  }, [isActive]);

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
        for (const id of ids) {
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
    []
  );

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedThreadGroup>[] }) => {
      const ids = new Set<string>();
      let autoplayPostId: string | null = null;
      const ordered = orderByIndex(viewableItems);
      for (const item of ordered) {
        const group = item.item as FeedThreadGroup | undefined;
        for (const post of group?.posts ?? []) {
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
    onRefresh: refresh,
    refreshing,
  });
  // Stable row renderer: same identity across scroll ticks so memoized cards
  // skip re-renders. Depends only on stable callbacks + theme + variant.
  const showCommunityReason =
    variant === "trending" || variant === "personalized";
  const renderGroup = useCallback(
    ({ item: group }: { item: FeedThreadGroup }) => (
      <View style={[styles.group, { borderBottomColor: theme.cardBorder }]}>
        {group.posts.map((post, index) => (
          <PostCard
            active={isActive}
            hasThreadChild={index < group.posts.length - 1}
            hasThreadParent={index > 0}
            key={post.id}
            onMore={handleOpenMore}
            onShare={handleShare}
            post={post}
            showAlt={altVisibleIds.has(post.id)}
            showCommunityReason={showCommunityReason}
            viewerId={userId}
          />
        ))}
      </View>
    ),
    [
      altVisibleIds,
      isActive,
      handleOpenMore,
      handleShare,
      showCommunityReason,
      theme.cardBorder,
      userId,
    ]
  );
  const prefetchKey = JSON.stringify(feedPrefetchUrls(posts, getApiBaseUrl()));
  useEffect(() => {
    if (!enabled || prefetchKey === "[]") {
      return;
    }
    const urls: string[] = JSON.parse(prefetchKey);
    const timer = setTimeout(() => {
      void Promise.allSettled(urls.map((url) => Image.prefetch(url)));
    }, 600);
    return () => clearTimeout(timer);
  }, [enabled, prefetchKey]);

  // Memoized above every early return: without this every parent render
  // handed FlatList a new data array identity, re-rendering every row.
  const groups = useMemo(() => groupPostsIntoThreads(posts), [posts]);

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
          description={copy.description}
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

  // Web's inline composer is rendered above the pager, not inside a list, so
  // the tabs carry no header of their own and every one of them reaches the
  // top of its own content.
  if (status === "loading" || (status === "idle" && enabled)) {
    return (
      <FeedState>
        <FeedSkeleton />
      </FeedState>
    );
  }

  if (status === "error" && posts.length === 0) {
    return (
      <FeedState>
        <View
          style={[
            styles.centerWrap,
            { paddingBottom: bottomInset + HEADER_BAR_HEIGHT },
          ]}
        >
          <View style={styles.errorWrap}>
            <Image
              contentFit="contain"
              source={errorImage}
              style={styles.errorArt}
            />
            <Text
              selectable
              style={[styles.errorTitle, { color: theme.errorBannerText }]}
            >
              An error occurred while loading posts.
            </Text>
            <Text
              selectable
              style={[styles.errorBody, { color: theme.dividerText }]}
            >
              Please try refreshing the page.
            </Text>
          </View>
        </View>
      </FeedState>
    );
  }

  if (status === "success" && posts.length === 0 && !hasMore) {
    const copy = EMPTY_COPY[variant];
    return (
      <FeedState>
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
            {copy.title}
          </Text>
          <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
            {copy.description}
          </Text>
        </View>
      </FeedState>
    );
  }

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
              contentContainerStyle={{
                paddingBottom: HEADER_BAR_HEIGHT + bottomInset,
              }}
              data={groups}
              keyExtractor={feedGroupKey}
              {...LIST_VIRTUALIZATION_PROPS}
              onEndReached={fetchNext}
              onEndReachedThreshold={0.5}
              onMomentumScrollEnd={(event) => {
                scrollMemory.set(
                  memoryKey,
                  Math.max(0, event.nativeEvent.contentOffset.y)
                );
              }}
              onScroll={(event) => {
                const offsetY = event.nativeEvent.contentOffset.y;
                if (offsetY >= 0) {
                  scrollMemory.set(memoryKey, offsetY);
                }
                if (enabledRef.current) {
                  reportFeedScroll(offsetY);
                }
                // The pull reads the same bounce offset and keeps its progress
                // in the loader, so none of this re-renders the list.
                pull.onScroll(event);
              }}
              onScrollEndDrag={() => pull.onScrollEndDrag()}
              onViewableItemsChanged={handleViewableItemsChanged}
              // Android detaches list children that scroll out of the
              // viewport, which cuts a row's thread rail off where it bleeds
              // past the card's own bounds.
              removeClippedSubviews={false}
              ref={listRef}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
              viewabilityConfig={STABLE_VIEWABILITY}
              renderItem={renderGroup}
              ListFooterComponent={footer}
              // The composer lives here, as real content. It scrolls away with
              // the first post and returns on pull-down for free, because the
              // list's own scroll already moves it - no overlay, no clipped
              // layer over the scroll view, and no per-frame work of our own.
              ListHeaderComponent={header}
            />
          </GestureDetector>
        </Animated.View>
        {pull.loader}
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
          <View style={[styles.undoWrap, { pointerEvents: "box-none" }]}>
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
  errorArt: {
    height: 176,
    opacity: 0.85,
    width: 176,
  },
  errorBody: {
    alignSelf: "stretch",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
    maxWidth: 420,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
  errorWrap: {
    alignItems: "center",
    gap: 16,
    maxWidth: 520,
    paddingHorizontal: 16,
    width: "100%",
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
  stateWrap: {
    flex: 1,
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
