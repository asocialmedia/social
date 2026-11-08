// The merged hashtag list, a port of web's `components/posts/views/hashtag-feed.tsx`:
// asocialmedia and Bluesky posts interleaved newest-first, with web's
// Network-settings error, loading skeleton, empty copy, partial-failure footer
// and infinite scroll that pages both sources.
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { BlueskyPostCard } from "@/features/feed/components/bluesky-post-card";
import {
  FeedSkeleton,
  FeedSkeletonCard,
} from "@/features/feed/components/feed-skeleton";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreAction,
} from "@/features/feed/components/more-menu";
import { PostCard } from "@/features/feed/components/post-card";
import { FeedMediaScope } from "@/features/feed/components/post-media";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import { usePostOverflow } from "@/features/feed/components/use-post-overflow";
import { externalPostView } from "@/features/feed/lib/external-post-view";
import { FEED_LOAD_MORE_SKELETON_COUNT } from "@/features/feed/lib/feed-skeleton-layout";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { orderByIndex } from "@/features/feed/lib/feed-types";
import { hasVideoAttachment } from "@/features/feed/lib/media-kind";
import { nativePostForRow } from "@/features/feed/lib/mixed-feed-rows";
import type { TimelineRow } from "@/features/feed/lib/mixed-feed-rows";
import {
  setAutoplayPostId,
  setFeedMediaActive,
  setVisiblePostIds,
} from "@/features/feed/lib/visible-posts";
import { useVideoCaptionsStore } from "@/features/feed/state/video-captions-store";
import type { ViewToken } from "@/lib/layout/list-virtualization";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { useAppTheme } from "@/theme";

import { useHashtagFeed } from "../state/use-hashtag-feed";

const VIEWABILITY = {
  minimumViewTime: 300,
  viewAreaCoveragePercentThreshold: 50,
};
// Web's `continuationDelay`: with nothing to show yet, the next page waits a
// beat instead of chaining requests back to back.
const EMPTY_CONTINUATION_MS = 800;

function rowKey(row: TimelineRow): string {
  return row.id;
}

function RetryState({
  compact,
  isRetrying,
  message,
  onRetry,
}: {
  compact: boolean;
  isRetrying: boolean;
  message: string;
  onRetry: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={compact ? styles.retryCompact : styles.retryFull}>
      <Text
        style={[styles.body, styles.centered, { color: theme.dividerText }]}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isRetrying }}
        disabled={isRetrying}
        hitSlop={6}
        onPress={onRetry}
        style={isRetrying ? styles.disabled : undefined}
      >
        <Text style={[styles.retryText, { color: theme.inputText }]}>
          {isRetrying ? "Retrying…" : "Try again"}
        </Text>
      </Pressable>
    </View>
  );
}

export function HashtagFeed({ tag }: { tag: string }) {
  const { theme } = useAppTheme();
  const isFocused = useIsFocused();
  const feed = useHashtagFeed(tag);
  const {
    failed,
    fetching,
    hasContent,
    hasMore,
    loadMore,
    network,
    retry,
    rows,
    scope,
    view,
    viewerId,
  } = feed;

  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [moreTarget, setMoreTarget] = useState<{
    anchor: MenuAnchor;
    post: FeedPost;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [patches, setPatches] = useState<
    ReadonlyMap<string, Partial<FeedPost>>
  >(() => new Map());
  const showCaptions = useVideoCaptionsStore((state) => state.showCaptions);
  const toggleCaptions = useVideoCaptionsStore((state) => state.toggleCaptions);

  const hidePost = useCallback((postId: string) => {
    setHiddenIds((current) => new Set(current).add(postId));
  }, []);
  const patchPost = useCallback((postId: string, patch: Partial<FeedPost>) => {
    setPatches((current) =>
      new Map(current).set(postId, { ...current.get(postId), ...patch })
    );
  }, []);
  const overflow = usePostOverflow({
    onDeleted: hidePost,
    onHide: (post) => hidePost(post.id),
    onModerated: patchPost,
    onTagsSaved: (postId, tags) =>
      patchPost(postId, { tags: tags.map((name) => ({ id: name, name })) }),
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
    onToggleCaptions: () => toggleCaptions(),
    viewerId: viewerId ?? null,
  });
  const handleOpenMore = useCallback((post: FeedPost, anchor: MenuAnchor) => {
    setMoreTarget({ anchor, post });
  }, []);
  const handleShare = useCallback((post: FeedPost) => {
    setSharePost(post);
  }, []);
  const handleMoreAction = useCallback(
    (action: MoreAction) => {
      if (moreTarget) {
        overflow.onAction(action, moreTarget.post);
      }
    },
    [moreTarget, overflow]
  );

  // Media follows the home feed's contract: this list owns the visible ids and
  // the single autoplaying video while the screen is focused.
  const mediaScope = `hashtag:${scope}`;
  const mediaActive = useRef(isFocused);
  const visibleIds = useRef<ReadonlySet<string>>(new Set());
  const autoplayId = useRef<string | null>(null);
  useEffect(() => {
    mediaActive.current = isFocused;
    setFeedMediaActive(mediaScope, isFocused);
    if (!isFocused) {
      return;
    }
    setVisiblePostIds(visibleIds.current);
    setAutoplayPostId(autoplayId.current);
    return () => {
      mediaActive.current = false;
      setFeedMediaActive(mediaScope, false);
      setVisiblePostIds(new Set());
      setAutoplayPostId(null);
    };
  }, [isFocused, mediaScope]);
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<TimelineRow>[] }) => {
      const ids = new Set<string>();
      let autoplay: string | null = null;
      for (const token of orderByIndex(viewableItems)) {
        const post =
          token.item.kind === "bluesky"
            ? externalPostView(token.item.value)
            : nativePostForRow(token.item);
        if (post) {
          ids.add(post.id);
          if (!autoplay && hasVideoAttachment(post)) {
            autoplay = post.id;
          }
        }
      }
      visibleIds.current = ids;
      autoplayId.current = autoplay;
      if (mediaActive.current) {
        setVisiblePostIds(new Set(ids));
        setAutoplayPostId(autoplay);
      }
    },
    []
  );

  // Sources can page past windows the filters empty out; keep going after a
  // pause, as web's InfiniteScrollContainer does with its continuation delay.
  const waitingForContent =
    view === "content" && !hasContent && hasMore && !fetching && !failed;
  useEffect(() => {
    if (!waitingForContent) {
      return;
    }
    const timer = setTimeout(loadMore, EMPTY_CONTINUATION_MS);
    return () => clearTimeout(timer);
  }, [loadMore, waitingForContent]);

  const visibleRows = rows.filter(
    (row) => row.kind === "bluesky" || !hiddenIds.has(row.value.post.id)
  );

  const renderRow = useCallback(
    ({ item }: { item: TimelineRow }) => {
      if (item.kind === "bluesky") {
        return <BlueskyPostCard post={item.value} />;
      }
      const row = item.value;
      const patch = patches.get(row.post.id);
      return (
        <View
          style={{
            borderBottomColor: theme.cardBorder,
            borderBottomWidth: row.hasThreadChild ? 0 : 1,
          }}
        >
          <PostCard
            active
            hasThreadChild={row.hasThreadChild}
            hasThreadParent={row.hasThreadParent}
            onMore={handleOpenMore}
            onShare={handleShare}
            post={patch ? { ...row.post, ...patch } : row.post}
            showAlt={altVisibleIds.has(row.post.id)}
            viewerId={viewerId}
          />
        </View>
      );
    },
    [
      altVisibleIds,
      handleOpenMore,
      handleShare,
      patches,
      theme.cardBorder,
      viewerId,
    ]
  );

  if (view === "network-error") {
    return (
      <RetryState
        compact={false}
        isRetrying={network.isFetching}
        message="Couldn't load your Network settings. Please try again."
        onRetry={() => {
          void network.refetch();
        }}
      />
    );
  }
  if (view === "loading") {
    return <FeedSkeleton />;
  }
  if (view === "error") {
    return (
      <RetryState
        compact={false}
        isRetrying={fetching}
        message="We couldn't load posts for this hashtag. Please try again."
        onRetry={retry}
      />
    );
  }
  if (view === "empty") {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          No posts found for #{tag}
        </Text>
        <Text
          style={[styles.body, styles.centered, { color: theme.dividerText }]}
        >
          Be the first to rustle something about this topic.
        </Text>
      </View>
    );
  }

  let footer: ReactElement | undefined;
  if (failed) {
    footer = (
      <RetryState
        compact={hasContent}
        isRetrying={fetching}
        message={
          hasContent
            ? "Some posts couldn't load. Please try again."
            : "We couldn't load posts for this hashtag. Please try again."
        }
        onRetry={retry}
      />
    );
  } else if (fetching || waitingForContent) {
    // Web's LoadMoreSkeleton: four post skeletons rather than a spinner.
    footer = (
      <View>
        {Array.from({ length: FEED_LOAD_MORE_SKELETON_COUNT }, (_, index) => (
          <View
            key={index}
            style={{
              borderBottomColor: theme.cardBorder,
              borderBottomWidth: 1,
            }}
          >
            <FeedSkeletonCard />
          </View>
        ))}
      </View>
    );
  }

  return (
    <FeedMediaScope.Provider value={mediaScope}>
      <View style={styles.root}>
        <FlatList
          {...LIST_VIRTUALIZATION_PROPS}
          contentContainerStyle={styles.content}
          data={visibleRows}
          keyExtractor={rowKey}
          ListFooterComponent={footer}
          onEndReached={loadMore}
          // Web prefetches 800px ahead of the bottom.
          onEndReachedThreshold={1}
          onViewableItemsChanged={handleViewableItemsChanged}
          renderItem={renderRow}
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
          viewabilityConfig={VIEWABILITY}
        />
        <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
        <MoreMenu
          anchor={moreTarget?.anchor ?? null}
          entries={
            moreTarget
              ? overflow.entriesFor(moreTarget.post, {
                  showCaptions,
                  showingAlt: altVisibleIds.has(moreTarget.post.id),
                })
              : []
          }
          onAction={handleMoreAction}
          onClose={() => setMoreTarget(null)}
        />
        {overflow.dialogs}
      </View>
    </FeedMediaScope.Provider>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  centered: { textAlign: "center" },
  content: { paddingBottom: 48 },
  disabled: { opacity: 0.5 },
  empty: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 64,
  },
  emptyTitle: { fontFamily: "SofiaProMed", fontSize: 15 },
  retryCompact: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  retryFull: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 64,
  },
  retryText: { fontFamily: "SofiaProMed", fontSize: 13, padding: 8 },
  root: { flex: 1 },
});
