// The HackerNews screen, ported from web's `app/(main)/hackernews/` and
// `components/hackernews/`: the three sort tabs, the search field with its
// type-filter menu, and the paged story list.
//
// The chrome is pinned above the list the way web pins it, and the header is
// the FIRST child of the root. It is not positioned: MobileHeader is a plain
// SafeAreaView + bar that expects to be the first flex child and takes the top
// of the screen from wherever it sits. Rendering it after the list pinned it to
// the bottom edge, and the list's hardcoded `paddingTop: 56` was standing in
// for a header that was never above it.
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import noSearchImage from "@/assets/images/nosearch.png";
import notFoundImage from "@/assets/images/notfound.png";
import { toast } from "@/components/feedback/toast";
import { themeText } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import {
  HEADER_BAR_HEIGHT,
  reportFeedScroll,
  resetHeaderScroll,
} from "@/features/feed/lib/header-visibility";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { useSearchStore } from "@/features/search/state/search-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import { MobileBottomNav } from "../../home/components/mobile-bottom-nav";
import { headerSlide, MobileHeader } from "../../home/components/mobile-header";
import {
  fetchHnBookmarkStates,
  fetchHnPage,
  HnApiError,
  HN_SORT_OPTIONS,
  setHnBookmark,
} from "../lib/hackernews-api";
import type { HnFilter, HnSort, HnStory } from "../lib/hackernews-api";
import { HnFeedSkeleton, HnFeedSkeletonCard } from "./hn-feed-skeleton";
import { HnSearchBar } from "./hn-search-bar";
import { HnStoryCard, hnItemUrl } from "./hn-story-card";

export function HackerNewsScreen() {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPending, user } = useSessionContext();
  const showUser = !isPending && Boolean(user);
  const unreadCount = useUnreadNotificationCount(user?.id ?? null, showUser);
  const openComposer = useComposerStore((state) => state.open);
  const setDraft = useComposerStore((state) => state.setDraft);

  // Web's "Reshare as fleet" opens the composer carrying the story, which the
  // publish sends as hnStory so the server records the share.
  const reshare = (story: HnStory) => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    setDraft({
      hnStory: {
        by: story.by,
        // HnStory names it `comments`; the publish shape names it
        // `descendants`, which is the field the Hacker News API uses.
        descendants: story.comments,
        score: story.score,
        // HnStory.id is a number, and the publish shape wants a string.
        storyId: String(story.id),
        time: story.time,
        title: story.title,
        url: story.url,
      },
    });
    openComposer("post", null);
    toast({
      description: "Add your thoughts and share it with your followers!",
      title: "Story Ready",
    });
  };
  const params = useLocalSearchParams<{ sort?: string | string[] }>();
  const initialSort = Array.isArray(params.sort) ? params.sort[0] : params.sort;

  const [sort, setSort] = useState<HnSort>(
    HN_SORT_OPTIONS.some((option) => option.value === initialSort)
      ? (initialSort as HnSort)
      : "score"
  );
  const [filter, setFilter] = useState<HnFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [stories, setStories] = useState<HnStory[]>([]);
  const [page, setPage] = useState(1);
  const [bookmarks, setBookmarks] = useState<Record<number, boolean>>({});
  const [rateLimited, setRateLimited] = useState(false);
  const [status, setStatus] = useState<"error" | "loading" | "success">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  // Seeded once and refreshed with each load, so the relative times on the rows
  // are stable across a re-render instead of moving on every frame.
  const [now, setNow] = useState(() => Date.now());
  const [dockHeight, setDockHeight] = useState(56);
  const [loadingMore, setLoadingMore] = useState(false);

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

  const options = useCallback(
    async () => ({
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    }),
    []
  );

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const resolved = await options();
      const result = await fetchHnPage(
        { page: nextPage, search: query, sort, type: filter },
        resolved
      );
      setRateLimited(result.rateLimited);
      if (result.rateLimited) {
        return;
      }
      const next = append
        ? [
            ...stories,
            ...result.stories.filter(
              (story) => !stories.some((row) => row.id === story.id)
            ),
          ]
        : result.stories;
      setStories(next);
      setNow(Date.now());
      setPage(nextPage);
      if (user && next.length > 0) {
        setBookmarks(
          await fetchHnBookmarkStates(
            next.map((story) => story.id),
            resolved
          )
        );
      }
    },
    [filter, options, query, sort, stories, user]
  );

  const fetchFirstPage = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const resolved = await options();
      const result = await fetchHnPage(
        { page: 1, search: query, sort, type: filter },
        resolved
      );
      setRateLimited(result.rateLimited);
      setStories(result.stories);
      setNow(Date.now());
      setPage(1);
      setStatus("success");
      if (user && result.stories.length > 0) {
        setBookmarks(
          await fetchHnBookmarkStates(
            result.stories.map((story) => story.id),
            resolved
          )
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof HnApiError
          ? loadError.message
          : "Couldn't load HackerNews right now."
      );
      setStatus("error");
    }
  }, [filter, options, query, sort, user]);

  // The first page is the effect: resetting the status before the fetch runs is
  // the point, and fetchFirstPage does that synchronously before it awaits.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- see above
    void fetchFirstPage();
  }, [fetchFirstPage]);

  // The hide-on-scroll signal is module state shared with MobileHeader and the
  // dock, so leaving the page with the bar hidden would hand that state to the
  // next screen. FeedList resets it on the way out too.
  useEffect(() => resetHeaderScroll, []);

  const toggleBookmark = (story: HnStory) => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    const next = !(bookmarks[story.id] ?? false);
    setBookmarks((current) => ({ ...current, [story.id]: next }));
    void (async () => {
      const ok = await setHnBookmark(story.id, next, await options());
      if (ok) {
        toast({
          description: next
            ? "Saved to your bookmarks"
            : "Removed from bookmarks",
          title: next ? "Saved" : "Removed",
        });
        return;
      }
      // Roll the optimistic toggle back rather than leaving a lie on the row.
      setBookmarks((current) => ({ ...current, [story.id]: !next }));
      toast({
        description: "Couldn't update that bookmark",
        title: "That didn't work",
        variant: "destructive",
      });
    })();
  };

  // Web collapses the top bar on scroll down and leaves the sort tabs pinned
  // under it. Native does the same by sliding the header out and bringing the
  // block below it up by exactly the bar height, with the matching negative
  // margin so the block extends past the fold and no strip is left behind.
  const followUp = headerSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_BAR_HEIGHT],
  });

  // Web's LoadMoreSkeleton appears for the duration of the next page fetch and
  // the footer clears on settle, so this owns both halves of that state rather
  // than the list re-deriving them.
  const appendPage = useCallback(async () => {
    setLoadingMore(true);
    try {
      await load(page + 1, true);
    } catch {
      // Web swallows a failed page fetch too: the rows already on screen stay,
      // and the next end-reached tries again.
    }
    setLoadingMore(false);
  }, [load, page]);

  const handleEndReached = () => {
    if (status !== "success" || rateLimited || loadingMore) {
      return;
    }
    void appendPage();
  };

  const renderSeparator = () => (
    <View style={[styles.separator, { borderBottomColor: theme.cardBorder }]} />
  );

  // The four empty states are resolved together so the loading, rate-limited,
  // error and genuinely-empty cases cannot drift apart. Web treats a 429 as an
  // error with its own art and copy (the upstream feed recovers on its own), so
  // this does too rather than dressing it up as a distinct feature.
  const listEmpty = useMemo(() => {
    if (status === "loading") {
      return <HnFeedSkeleton />;
    }
    if (rateLimited) {
      return (
        <View style={[styles.state, styles.stateError]}>
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
            Rate limit exceeded. Please try again later.
          </Text>
          <Text style={[styles.stateHint, { color: theme.dividerText }]}>
            You&apos;re moving too fast, take a breather and try again.
          </Text>
        </View>
      );
    }
    if (status === "error") {
      return (
        <View style={[styles.state, styles.stateError]}>
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
            An error occurred while loading stories.
          </Text>
          <Text style={[styles.stateHint, { color: theme.dividerText }]}>
            {error ?? "Please try refreshing the page."}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.state}>
        <Image
          contentFit="contain"
          source={notFoundImage}
          style={styles.stateArt}
        />
        <Text style={[styles.stateTitle, { color: theme.inputText }]}>
          No stories found
        </Text>
        <Text style={[styles.stateHint, { color: theme.dividerText }]}>
          Try a different search or filter to find more stories.
        </Text>
      </View>
    );
  }, [error, isDark, rateLimited, status, theme.dividerText, theme.inputText]);

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
        <FeedTabs active={sort} onChange={setSort} tabs={HN_SORT_OPTIONS} />
        <View
          style={[styles.searchRow, { borderBottomColor: theme.cardBorder }]}
        >
          <HnSearchBar
            filter={filter}
            onFilterChange={setFilter}
            onSearchChange={setSearch}
            search={search}
          />
        </View>
        <FlatList
          {...LIST_VIRTUALIZATION_PROPS}
          contentContainerStyle={{
            flexGrow: 1,
            // Clears the dock, and the bar height so the last row stays
            // reachable while the header is showing over the top of it.
            paddingBottom: dockHeight + insets.bottom + HEADER_BAR_HEIGHT + 24,
          }}
          data={stories}
          ItemSeparatorComponent={renderSeparator}
          keyExtractor={(story) => String(story.id)}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={loadingMore ? <HnFeedSkeletonCard /> : null}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          onRefresh={() => {
            void fetchFirstPage();
          }}
          onScroll={(event) =>
            reportFeedScroll(event.nativeEvent.contentOffset.y)
          }
          refreshing={status === "loading" && stories.length > 0}
          renderItem={({ item }) => (
            <HnStoryCard
              bookmarked={bookmarks[item.id] ?? false}
              now={now}
              onReshare={reshare}
              onToggleBookmark={toggleBookmark}
              // A HackerNews story is not a post on this platform, so the row
              // opens the story's own link, falling back to its discussion.
              onVisit={(story) => {
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
              }}
              story={item}
            />
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
          style={styles.list}
        />
      </Animated.View>
      <MobileBottomNav onHeightChange={setDockHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  // The list takes the rest of the column. Stated rather than implied because
  // RN's default flexShrink is 0, so a scroll view without it would size to its
  // content and push the chrome off the top instead of scrolling under it.
  list: { flex: 1 },
  root: { flex: 1 },
  searchRow: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  separator: { borderBottomWidth: 1, height: 1 },
  state: {
    alignItems: "center",
    flexGrow: 1,
    gap: 12,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 64,
  },
  stateArt: { height: 176, width: 211 },
  // Web's error block is `justify-end` with pt-10 pb-16, so the art sits low
  // on the screen rather than floating in the middle of it.
  stateError: { justifyContent: "flex-end", paddingBottom: 64, paddingTop: 40 },
  stateHint: { fontFamily: "SofiaProReg", fontSize: 12, textAlign: "center" },
  stateTitle: { fontFamily: "SofiaProBold", fontSize: 14, textAlign: "center" },
});
