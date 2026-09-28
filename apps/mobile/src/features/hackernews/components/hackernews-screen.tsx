// The HackerNews screen, ported from web's `app/(main)/hackernews/` and
// `components/hackernews/hn-feed.tsx`: the three sort tabs, the five type
// filters, a search field, and the paged story list. The 429 state gets its own
// treatment rather than an error, because the upstream feed recovers on its own.
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Clock, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { useAppTheme } from "@/theme";

import { MobileHeader } from "../../home/components/mobile-header";
import {
  fetchHnBookmarkStates,
  fetchHnPage,
  HnApiError,
  HN_FILTER_OPTIONS,
  HN_SORT_OPTIONS,
  setHnBookmark,
} from "../lib/hackernews-api";
import type { HnFilter, HnSort, HnStory } from "../lib/hackernews-api";
import { HnStoryCard, hnItemUrl } from "./hn-story-card";

export function HackerNewsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
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

  useEffect(() => {
    let active = true;
    void (async () => {
      setStatus("loading");
      setError(null);
      try {
        const resolved = await options();
        const result = await fetchHnPage(
          { page: 1, search: query, sort, type: filter },
          resolved
        );
        if (!active) {
          return;
        }
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
        if (!active) {
          return;
        }
        setError(
          loadError instanceof HnApiError
            ? loadError.message
            : "Couldn't load HackerNews right now."
        );
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [filter, options, query, sort, user]);

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

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <View style={styles.searchWrap}>
          <Search color={theme.dividerText} size={17} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search stories"
            placeholderTextColor={theme.inputPlaceholder}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.inputText }]}
            value={search}
          />
          {search ? (
            <Pressable
              accessibilityLabel="Clear search"
              hitSlop={8}
              onPress={() => {
                setSearch("");
              }}
            >
              <X color={theme.dividerText} size={16} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.tabs}>
          {HN_SORT_OPTIONS.map((option) => {
            const selected = option.value === sort;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={option.value}
                onPress={() => {
                  setSort(option.value);
                }}
                style={[
                  styles.tab,
                  selected && {
                    backgroundColor: "rgba(230, 85, 0, 0.08)",
                    borderColor: "#e65500",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: selected ? "#e65500" : theme.dividerText },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.filters}>
          {HN_FILTER_OPTIONS.map((option) => {
            const selected = option.value === filter;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={option.value}
                onPress={() => {
                  setFilter(option.value);
                }}
                style={styles.filter}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: selected ? "#e65500" : theme.dividerText },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    ),
    [filter, search, sort, theme]
  );

  // The four empty states are resolved together so the loading, rate-limited,
  // error and genuinely-empty cases cannot drift apart.
  const renderEmpty = () => {
    if (status === "loading") {
      return <ActivityIndicator color="#ff9500" style={styles.loader} />;
    }
    if (rateLimited) {
      return (
        <View style={styles.state}>
          <Clock color={theme.dividerText} size={30} />
          <Text style={[styles.stateTitle, { color: theme.inputText }]}>
            HackerNews is busy
          </Text>
          <Text style={[styles.stateBody, { color: theme.dividerText }]}>
            Too many requests right now. Give it a moment and pull to refresh.
          </Text>
        </View>
      );
    }
    if (status === "error") {
      return (
        <View style={styles.state}>
          <Text style={[styles.stateBody, { color: theme.dividerText }]}>
            {error}
          </Text>
          <Pressable
            accessibilityLabel="Try again"
            accessibilityRole="button"
            onPress={() => {
              void load(1, false);
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.state}>
        <Search color={theme.dividerText} size={30} />
        <Text style={[styles.stateTitle, { color: theme.inputText }]}>
          No stories found
        </Text>
        <Text style={[styles.stateBody, { color: theme.dividerText }]}>
          Try a different search or filter.
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <FlatList
        {...LIST_VIRTUALIZATION_PROPS}
        contentContainerStyle={styles.content}
        data={stories}
        keyExtractor={(story) => String(story.id)}
        ListEmptyComponent={renderEmpty()}
        ListHeaderComponent={header}
        onEndReached={() => {
          if (status === "success" && !rateLimited) {
            void load(page + 1, true);
          }
        }}
        onEndReachedThreshold={0.6}
        onRefresh={() => {
          void load(1, false);
        }}
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
        showsVerticalScrollIndicator={false}
      />
      <MobileHeader
        user={
          user
            ? {
                id: user.id,
                image: user.image,
                username: user.username ?? user.name,
              }
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 40, paddingTop: 56 },
  filter: { paddingHorizontal: 4, paddingVertical: 4 },
  filterText: { fontFamily: "SofiaProMed", fontSize: 12 },
  filters: { flexDirection: "row", gap: 14, paddingHorizontal: 2 },
  header: { gap: 10, paddingBottom: 4 },
  loader: { marginTop: 32 },
  retry: {
    borderColor: "#ff9500",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: { color: "#ff9500", fontFamily: "SofiaProMed", fontSize: 14 },
  root: { flex: 1 },
  searchInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minHeight: 40,
  },
  searchWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
  },
  state: { alignItems: "center", gap: 8, padding: 32 },
  stateBody: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 19,
    textAlign: "center",
  },
  stateTitle: { fontFamily: "SofiaProBold", fontSize: 16 },
  tab: {
    borderCurve: "continuous",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  tabText: { fontFamily: "SofiaProMed", fontSize: 13 },
  tabs: { flexDirection: "row", gap: 8 },
});
