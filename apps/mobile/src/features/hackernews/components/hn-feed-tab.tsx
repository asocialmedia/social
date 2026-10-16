// One HackerNews sort tab uses recycled story rows with the same
// virtualization and UI-thread scroll handling the home feed uses
// (features/feed/components/feed-list.tsx), so scrolling matches it instead of
// stuttering on the JS thread. Rows come from the per-sort hnCache, so a warm
// tab renders instantly and a stale one revalidates without a skeleton.
import { FlashList } from "@shopify/flash-list";
import type { FlashListRef } from "@shopify/flash-list";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ScrollViewProps } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import {
  createAnimatedComponent,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import noSearchImage from "@/assets/images/nosearch.png";
import notFoundImage from "@/assets/images/notfound.png";
import { toast } from "@/components/feedback/toast";
import { usePullToRefresh } from "@/components/feedback/use-pull-to-refresh";
import { themeText } from "@/components/surface/recipes";
import {
  advanceHeaderScroll,
  HEADER_BAR_HEIGHT,
  resetHeaderScroll,
  setHeaderHidden,
} from "@/features/feed/lib/header-visibility";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import type { HnSort, HnStory } from "../lib/hackernews-api";
import { hnCache, hnCacheKey } from "../lib/hn-cache";
import { useHnFeed } from "../state/use-hn-feed";
import { HnFeedSkeleton, HnFeedSkeletonCard } from "./hn-feed-skeleton";
import { HnStoryCard, hnItemUrl } from "./hn-story-card";

const AnimatedHnList = createAnimatedComponent(FlashList<HnStory>);
const MAINTAIN_POSITION = { disabled: true };

function hnStoryKey(story: HnStory): string {
  return String(story.id);
}

interface HnFeedTabProps {
  active: boolean;
  apiBase: string;
  bottomInset: number;
  enabled: boolean;
  onReshare: (story: HnStory) => void;
  search: string;
  sort: HnSort;
  userId: string | undefined;
}

export const HnFeedTab = memo(
  ({
    active,
    apiBase,
    bottomInset,
    enabled,
    onReshare,
    search,
    sort,
    userId,
  }: HnFeedTabProps) => {
    const { isDark, theme } = useAppTheme();
    const listRef = useRef<FlashListRef<HnStory>>(null);
    const [viewportHeight, setViewportHeight] = useState(0);
    const contentBottom = bottomInset + HEADER_BAR_HEIGHT + 24;
    const emptyHeight = Math.max(0, viewportHeight - contentBottom);
    const memoryKey = hnCacheKey(apiBase, userId, sort, search);
    const scrollOffset = useSharedValue(hnCache.scrollOffset(memoryKey));
    const scrollActive = useSharedValue(false);
    const userScrolling = useSharedValue(false);
    const scrollVisibility = useSharedValue({ baseline: 0, hidden: false });
    const restoredKey = useRef<string | null>(null);

    const {
      bookmarks,
      fetchNext,
      hasMore,
      now,
      rateLimited,
      refresh,
      status,
      stories,
      toggleBookmark,
    } = useHnFeed({ active, enabled, search, sort, userId });

    const refreshing = status === "refreshing" || status === "loading";

    const onVisit = useCallback((story: HnStory) => {
      const target = story.url ?? hnItemUrl(story.id);
      void (async () => {
        try {
          await Linking.openURL(target);
        } catch {
          toast({
            description: "Couldn't open that link",
            title: "No luck",
            variant: "destructive",
          });
        }
      })();
    }, []);

    const onToggleBookmark = useCallback(
      (story: HnStory) => {
        void (async () => {
          const next = !(hnCache.read(memoryKey).bookmarks[story.id] ?? false);
          const ok = await toggleBookmark(story);
          if (ok) {
            toast({
              description: next
                ? "Saved to your bookmarks"
                : "Removed from bookmarks",
              title: next ? "Saved" : "Removed",
            });
            return;
          }
          toast({
            description: "Couldn't update that bookmark",
            title: "That didn't work",
            variant: "destructive",
          });
        })();
      },
      [memoryKey, toggleBookmark]
    );

    const saveOffset = useCallback(
      (offset: number) => {
        hnCache.setScrollOffset(memoryKey, offset);
      },
      [memoryKey]
    );

    const publishHidden = useCallback((hidden: boolean) => {
      setHeaderHidden(hidden);
    }, []);

    const pull = usePullToRefresh({
      failed: status === "error",
      onRefresh: refresh,
      refreshing,
    });
    const reportPullOffset = pull.onScrollOffset;
    const endPull = pull.onScrollEndDrag;
    const { nativeScrollGesture } = pull;
    // Attach Native to the actual ScrollView, not FlashList's outer View.
    const renderScrollComponent = useCallback(
      (props: ScrollViewProps & { ref?: Ref<ScrollView> }) => (
        <GestureDetector gesture={nativeScrollGesture}>
          <ScrollView {...props} />
        </GestureDetector>
      ),
      [nativeScrollGesture]
    );

    // Hide-on-scroll runs on the UI thread like the home feed: ordinary scrolling
    // never crosses to JS, only the hide flips and the top-edge crossings the pull
    // loader needs.
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
        }
        if (offset <= 0 || previous <= 0) {
          scheduleOnRN(reportPullOffset, offset);
        }
      },
    });

    // A freshly shown tab starts with the header visible; its own scroll takes
    // over hiding from there. Only the visible tab drives the shared signal.
    useEffect(() => {
      if (!active) {
        return;
      }
      const offset = Math.max(0, scrollOffset.get());
      scrollVisibility.set({ baseline: offset, hidden: false });
      scrollActive.set(true);
      resetHeaderScroll(offset);
      return () => {
        scrollActive.set(false);
      };
    }, [active, scrollOffset, scrollVisibility, scrollActive]);

    // Restore this tab's offset once per key, after content has landed. Keyed
    // rather than a boolean so a changed search (a new cache key) restores to its
    // own remembered position instead of the previous query's.
    useEffect(() => {
      if (
        !active ||
        restoredKey.current === memoryKey ||
        stories.length === 0
      ) {
        return;
      }
      restoredKey.current = memoryKey;
      const offset = hnCache.scrollOffset(memoryKey);
      if (offset > 0) {
        listRef.current?.scrollToOffset({ animated: false, offset });
      }
    }, [active, memoryKey, stories.length]);

    const renderItem = useCallback(
      ({ item }: { item: HnStory }) => (
        <View style={[styles.group, { borderBottomColor: theme.cardBorder }]}>
          <HnStoryCard
            bookmarked={bookmarks[item.id] ?? false}
            now={now}
            onReshare={onReshare}
            onToggleBookmark={onToggleBookmark}
            onVisit={onVisit}
            story={item}
          />
        </View>
      ),
      [bookmarks, now, onReshare, onToggleBookmark, onVisit, theme.cardBorder]
    );

    const empty = useMemo(() => {
      if (status === "loading" || (status === "idle" && enabled)) {
        return <HnFeedSkeleton />;
      }
      if (rateLimited) {
        return (
          <View style={[styles.state, { minHeight: emptyHeight }]}>
            <Image
              contentFit="contain"
              source={noSearchImage}
              style={styles.stateArt}
            />
            <Text
              style={[
                styles.stateTitle,
                { color: themeText(isDark).destructive },
              ]}
            >
              Let’s give HackerNews a moment.
            </Text>
            <Text style={[styles.stateHint, { color: theme.dividerText }]}>
              Please wait a little, then pull down to try again.
            </Text>
          </View>
        );
      }
      if (status === "error") {
        return (
          <View style={[styles.state, { minHeight: emptyHeight }]}>
            <Image
              contentFit="contain"
              source={noSearchImage}
              style={styles.stateArt}
            />
            <Text
              style={[
                styles.stateTitle,
                { color: themeText(isDark).destructive },
              ]}
            >
              We couldn’t load the stories right now.
            </Text>
            <Text style={[styles.stateHint, { color: theme.dividerText }]}>
              Check your connection, then pull down to try again.
            </Text>
          </View>
        );
      }
      return (
        <View style={[styles.state, { minHeight: emptyHeight }]}>
          <Image
            contentFit="contain"
            source={notFoundImage}
            style={styles.stateArt}
          />
          <Text style={[styles.stateTitle, { color: theme.inputText }]}>
            No stories found
          </Text>
          <Text style={[styles.stateHint, { color: theme.dividerText }]}>
            Try a different search to find more stories.
          </Text>
        </View>
      );
    }, [
      enabled,
      emptyHeight,
      isDark,
      rateLimited,
      status,
      theme.dividerText,
      theme.inputText,
    ]);

    const showLoader = status === "loading-more";
    const showEnd = status === "success" && !hasMore && stories.length > 0;
    let footer: ReactNode = null;
    if (showLoader) {
      footer = <HnFeedSkeletonCard />;
    } else if (showEnd) {
      footer = (
        <View style={styles.endWrap}>
          <Text style={[styles.endText, { color: theme.dividerText }]}>
            You&apos;re all caught up!
          </Text>
        </View>
      );
    }

    return (
      <GestureDetector gesture={pull.gesture}>
        <View
          style={styles.listWrap}
          onLayout={(event) =>
            setViewportHeight(event.nativeEvent.layout.height)
          }
        >
          <Animated.View
            style={[
              styles.listShift,
              { transform: [{ translateY: pull.pullShift }] },
            ]}
          >
            <AnimatedHnList
              renderScrollComponent={renderScrollComponent}
              contentContainerStyle={{
                flexGrow: 1,
                paddingBottom: contentBottom,
              }}
              data={stories}
              keyExtractor={hnStoryKey}
              ListEmptyComponent={empty}
              ListFooterComponent={footer}
              onEndReached={fetchNext}
              onEndReachedThreshold={0.5}
              onScroll={handleScroll}
              ref={listRef}
              renderItem={renderItem}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
              maintainVisibleContentPosition={MAINTAIN_POSITION}
            />
          </Animated.View>
          {pull.loader}
        </View>
      </GestureDetector>
    );
  }
);

HnFeedTab.displayName = "HnFeedTab";

const styles = StyleSheet.create({
  endText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    textAlign: "center",
  },
  endWrap: { paddingHorizontal: 16, paddingVertical: 40 },
  group: { borderBottomWidth: 1 },
  listShift: { flex: 1 },
  listWrap: { flex: 1, position: "relative" },
  state: {
    alignItems: "center",
    flexGrow: 1,
    gap: 12,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 64,
  },
  stateArt: { height: 176, width: 211 },
  stateHint: { fontFamily: "SofiaProReg", fontSize: 12, textAlign: "center" },
  stateTitle: { fontFamily: "SofiaProBold", fontSize: 14, textAlign: "center" },
});
