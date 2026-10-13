// The HackerNews screen, ported from web's `app/(main)/hackernews/` and
// `components/hackernews/`: the three sort tabs, the search field, and a swipe
// pager over one cached story list per sort.
//
// The chrome is pinned above the pager the way web pins it, and the header is
// the FIRST child of the root. It is not positioned: MobileHeader is a plain
// SafeAreaView + bar that expects to be the first flex child and takes the top
// of the screen from wherever it sits.
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toast } from "@/components/feedback/toast";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { FeedPager } from "@/features/feed/components/feed-pager";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import {
  HEADER_BAR_HEIGHT,
  resetHeaderScroll,
  subscribeHeaderVisibility,
} from "@/features/feed/lib/header-visibility";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { useSearchStore } from "@/features/search/state/search-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { MobileBottomNav } from "../../home/components/mobile-bottom-nav";
import { headerSlide, MobileHeader } from "../../home/components/mobile-header";
import { HN_SORT_OPTIONS } from "../lib/hackernews-api";
import type { HnSort, HnStory } from "../lib/hackernews-api";
import { HnFeedTab } from "./hn-feed-tab";
import { HnSearchBar } from "./hn-search-bar";

export function HackerNewsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { isPending, user } = useSessionContext();
  const showUser = !isPending && Boolean(user);
  const unreadCount = useUnreadNotificationCount(user?.id ?? null, showUser);
  const openWithContext = useComposerStore((state) => state.openWithContext);

  const params = useLocalSearchParams<{ sort?: string | string[] }>();
  const initialSort = Array.isArray(params.sort) ? params.sort[0] : params.sort;

  const [sort, setSort] = useState<HnSort>(
    HN_SORT_OPTIONS.some((option) => option.value === initialSort)
      ? (initialSort as HnSort)
      : "score"
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [dockHeight, setDockHeight] = useState(56);
  // Measured from the tabs' natural (unclipped) height, so it is real from the
  // first layout. The wrapper is never given a zero height up front, which is
  // what previously made the strip measure as 0 and stay collapsed forever.
  const [tabsHeight, setTabsHeight] = useState(0);
  // Local, JS-driven companion to the native header slide. The header's shared
  // value cannot carry a layout change (the native driver forbids it), so the
  // tabs' space collapses on this one, kept in lockstep by the same visibility
  // signal; as it closes, the search row below rides up into its place.
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; driven by the subscription below
  const [tabsLift] = useState(() => new Animated.Value(0));

  // Web debounces the search field before it reaches the feed; the same 300ms
  // is applied here so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  // Web's "Reshare as fleet" opens the composer carrying the story, which the
  // publish sends as hnStory so the server records the share.
  const reshare = useCallback(
    (story: HnStory) => {
      if (!user) {
        router.push("/(auth)/login");
        return;
      }
      openWithContext({
        kind: "hn",
        story: {
          by: story.by,
          // HnStory names it `comments`; the publish shape names it
          // `descendants`, which is the field the Hacker News API uses.
          descendants: story.comments,
          score: story.score,
          storyId: story.id,
          time: story.time,
          title: story.title,
          url: story.url,
        },
      });
      toast({
        description: "Add your thoughts and share it with your followers!",
        title: "Story Ready",
      });
    },
    [openWithContext, router, user]
  );

  // The hide-on-scroll signal is module state shared with MobileHeader and the
  // dock, so leaving the page with the bar hidden would hand that state to the
  // next screen.
  useEffect(() => resetHeaderScroll, []);

  // The header bar slides out on scroll down and the sort tabs collapse with
  // it, leaving the search bar resting at the very top; scrolling up brings
  // both back. This is the home feed's proven layout (move the block up by the
  // bar height, extend it past the fold with a matching negative margin) plus a
  // measured height collapse on the tabs, which is what lets the tabs vanish
  // while the search row - their next sibling - rides up to take their place.
  const followUp = headerSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_BAR_HEIGHT],
  });
  // Drives the tabs' measured height on the same hide flip as the header, with
  // the same 220ms ease-out-cubic, so the two collapse as one motion. Layout
  // props cannot ride the native headerSlide, so this is a JS-thread value fed
  // by the shared visibility signal.
  useEffect(
    () =>
      subscribeHeaderVisibility((hidden) => {
        Animated.timing(tabsLift, {
          duration: 220,
          easing: Easing.out(Easing.cubic),
          toValue: hidden ? 1 : 0,
          // A height is a layout property, which the native driver refuses; this
          // one value is therefore JS-thread and drives only the tabs.
          useNativeDriver: false,
        }).start();
      }),
    [tabsLift]
  );
  const tabsCollapse = tabsLift.interpolate({
    inputRange: [0, 1],
    outputRange: [tabsHeight, 0],
  });

  const activeIndex = Math.max(
    0,
    HN_SORT_OPTIONS.findIndex((option) => option.value === sort)
  );
  const apiBase = useMemo(() => getApiBaseUrl(), []);
  const bottomInset = dockHeight + insets.bottom;

  const handleIndexChange = useCallback(
    (index: number) => {
      const option = HN_SORT_OPTIONS[index];
      if (option && option.value !== sort) {
        setSort(option.value);
      }
    },
    [sort]
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        onSearchPress={() => useSearchStore.getState().open()}
        unreadCount={unreadCount}
        user={
          user
            ? {
                avatarUrl: user.image ?? null,
                id: user.id,
                image: user.image,
                username: user.username ?? user.name,
              }
            : null
        }
      />
      <Animated.View
        style={[
          styles.content,
          {
            marginBottom: -HEADER_BAR_HEIGHT,
            transform: [{ translateY: followUp }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.tabsWrap,
            {
              // Until the strip has measured its natural height the wrapper is
              // left unconstrained: clipping it to a height derived from a
              // not-yet-measured value of 0 collapsed it on Android and it
              // could never report anything but 0 again.
              height: tabsHeight > 0 ? tabsCollapse : undefined,
              overflow: "hidden",
            },
          ]}
        >
          <View
            onLayout={(event) => {
              // Only accept a real measurement: once the wrapper is clipping the
              // strip, Android reports the collapsed 0, and writing that back
              // would drop the strip to zero height for good.
              const { height } = event.nativeEvent.layout;
              if (height > 0) {
                setTabsHeight(height);
              }
            }}
          >
            <FeedTabs active={sort} onChange={setSort} tabs={HN_SORT_OPTIONS} />
          </View>
        </Animated.View>
        <Animated.View
          style={[
            styles.searchRow,
            {
              backgroundColor: theme.containerBg,
              borderBottomColor: theme.cardBorder,
            },
          ]}
        >
          <HnSearchBar onSearchChange={setSearch} search={search} />
        </Animated.View>
        <View style={styles.pagerWrap}>
          <FeedPager
            activeIndex={activeIndex}
            onIndexChange={handleIndexChange}
          >
            {HN_SORT_OPTIONS.map((option, index) => (
              <HnFeedTab
                active={isFocused && index === activeIndex}
                apiBase={apiBase}
                bottomInset={bottomInset}
                // Neighbours preload their data so a swipe lands on cached rows.
                // A search preloads only the visible sort: fetching all three per
                // debounced query would triple the requests for no benefit.
                enabled={
                  isFocused &&
                  (query
                    ? index === activeIndex
                    : Math.abs(index - activeIndex) <= 1)
                }
                key={`${option.value}:${user?.id ?? "guest"}`}
                onReshare={reshare}
                search={query}
                sort={option.value}
                userId={user?.id}
              />
            ))}
          </FeedPager>
        </View>
      </Animated.View>
      <MobileBottomNav onHeightChange={setDockHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  // The pager clips at its own top: the story lists scroll under the search
  // row rather than pushing it, since the row is a sibling above them.
  pagerWrap: { flex: 1, overflow: "hidden" },
  root: { flex: 1 },
  searchRow: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    // Above the pager so the pinned row paints over the list scrolling under it.
    zIndex: 20,
  },
  // The tabs keep their natural height; the animated wrapper clips it to zero
  // as they collapse on scroll, so no measure/layout guess is needed.
  tabsWrap: { position: "relative" },
});
