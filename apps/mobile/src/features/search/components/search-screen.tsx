// oxlint-disable no-nested-ternary, curly, unicorn/no-nested-ternary, no-negated-condition, unicorn/no-negated-condition, react/todo, react/set-state-in-effect, unicorn/no-useless-undefined
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Clock3, Flame, Search, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { mediaGridImageUrl } from "../../feed/lib/media-url";
import { MobileHeader } from "../../home/components/mobile-header";
import {
  clearSearchHistory,
  fetchSearchHistoryRaw,
  fetchSearchSuggestions,
  fetchSpotlight,
  recordSearchPost,
  recordSearchQuery,
  recordSearchUser,
  removeSearchHistoryItem,
} from "../lib/search-api";
import type {
  SearchCommunityResult,
  SearchPostResult,
  SearchSuggestion,
  SearchUserResult,
  SpotlightResponse,
} from "../lib/search-api";
import {
  historyItemKey,
  historyItemLabel,
  parseHistoryItem,
} from "../lib/search-history";
import type { SearchHistoryItem } from "../lib/search-history";

const EMPTY_RESULTS: SpotlightResponse = {
  communities: [],
  posts: [],
  users: [],
};

function ResultRow({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function UserResult({
  onOpen,
  user,
}: {
  onOpen: (user: SearchUserResult) => void;
  user: SearchUserResult;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  return (
    <ResultRow
      onPress={() => {
        onOpen(user);
        router.push({
          params: { username: user.username },
          pathname: "/users/[username]",
        });
      }}
    >
      <UserAvatar size={40} url={user.avatarUrl} />
      <View style={styles.rowCopy}>
        <Text
          numberOfLines={1}
          style={[styles.rowTitle, { color: theme.inputText }]}
        >
          {user.displayName}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.rowSubtitle, { color: theme.dividerText }]}
        >
          @{user.username}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <Flame color="#ff9500" fill="#ff9500" size={14} />
        <Text style={[styles.metaText, { color: theme.dividerText }]}>
          {user.aura}
        </Text>
      </View>
    </ResultRow>
  );
}

function CommunityResult({ community }: { community: SearchCommunityResult }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  return (
    <ResultRow
      onPress={() =>
        router.push({ params: { slug: community.slug }, pathname: "/a/[slug]" })
      }
    >
      <View
        style={[
          styles.communityAvatar,
          { backgroundColor: community.accentColor },
        ]}
      >
        <Users color="#fff" size={19} />
      </View>
      <View style={styles.rowCopy}>
        <Text
          numberOfLines={1}
          style={[styles.rowTitle, { color: theme.inputText }]}
        >
          {community.name}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.rowSubtitle, { color: theme.dividerText }]}
        >
          a/{community.slug} · {community.memberCount} members
        </Text>
      </View>
    </ResultRow>
  );
}

function PostResult({
  onOpen,
  post,
}: {
  onOpen: (post: SearchPostResult) => void;
  post: SearchPostResult;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const preview = post.previewMedia
    ? mediaGridImageUrl(getApiBaseUrl(), {
        id: post.previewMedia.id,
        mimeType: null,
        thumbnailKey: post.previewMedia.thumbnailKey,
        type: post.previewMedia.type,
      })
    : null;
  return (
    <ResultRow
      onPress={() => {
        onOpen(post);
        router.push({
          params: { postId: post.id },
          pathname: "/posts/[postId]",
        });
      }}
    >
      <UserAvatar size={36} url={post.authorAvatarUrl} />
      <View style={styles.rowCopy}>
        <Text
          numberOfLines={3}
          style={[styles.postContent, { color: theme.inputText }]}
        >
          {post.content}
        </Text>
        <View style={styles.postMeta}>
          <Text style={[styles.metaText, { color: theme.dividerText }]}>
            @{post.authorUsername}
          </Text>
          <Flame color="#ff9500" fill="#ff9500" size={12} />
          <Text style={[styles.metaText, { color: theme.dividerText }]}>
            {post.aura}
          </Text>
          <Text style={[styles.metaText, { color: theme.dividerText }]}>
            {formatRelativeDate(post.createdAt)}
          </Text>
        </View>
      </View>
      {preview ? (
        <Image
          contentFit="cover"
          source={{ uri: preview }}
          style={styles.preview}
        />
      ) : null}
    </ResultRow>
  );
}

// Web's history rows carry a different mark per kind: a clock for a query, the
// person's avatar for a user, the author's avatar for a post.
function HistoryGlyph({ item }: { item: SearchHistoryItem }) {
  const { theme } = useAppTheme();
  if (item.type === "query") {
    return <Clock3 color={theme.dividerText} size={17} />;
  }
  if (item.type === "user") {
    return <UserAvatar size={30} url={item.user.avatarUrl} />;
  }
  return <UserAvatar size={30} url={null} />;
}

export function SearchScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const [input, setInput] = useState("");
  const [results, setResults] = useState<SpotlightResponse>(EMPTY_RESULTS);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [history, setHistory] = useState<
    { item: SearchHistoryItem; key: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The session cookie is resolved once into state and reused by every read and
  // write below; authClient.getCookie() is not free and history touches it often.
  // It has to be an effect rather than a memo because the value is async, and
  // useMemo may not hold a promise.
  const [cookie, setCookie] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void (async () => {
      const next = user ? await authClient.getCookie() : undefined;
      if (active) {
        setCookie(next);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const options = useMemo(
    () => ({ apiBase: getApiBaseUrl(), cookie }),
    [cookie]
  );

  const loadHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    try {
      const resolved = options;
      const raw = await fetchSearchHistoryRaw(resolved);
      setHistory(
        raw.flatMap((entry) => {
          const item = parseHistoryItem(entry);
          return item ? [{ item, key: historyItemKey(item, entry) }] : [];
        })
      );
    } catch {
      // History is an enhancement; a failure leaves the list empty rather than
      // blocking the screen.
      setHistory([]);
    }
  }, [options, user]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const query = input.trim();
    if (!query) {
      setResults(EMPTY_RESULTS);
      setSuggestions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const resolved = options;
          const [nextResults, nextSuggestions] = await Promise.all([
            fetchSpotlight(query, resolved),
            fetchSearchSuggestions(query, resolved),
          ]);
          if (!cancelled) {
            setResults(nextResults);
            setSuggestions(nextSuggestions);
            setError(null);
          }
        } catch {
          if (!cancelled) {
            setError("Search is unavailable right now.");
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, options]);

  const hasQuery = input.trim().length > 0;
  const hasResults = useMemo(
    () =>
      results.communities.length + results.posts.length + results.users.length >
      0,
    [results]
  );

  // Opening a result records it, so the trail reflects what was actually looked
  // at rather than only what was typed. Best effort: web swallows these too.
  const onOpenUser = useCallback(
    (target: SearchUserResult) => {
      if (user) {
        void (async () => {
          await recordSearchUser(
            {
              displayName: target.displayName,
              id: target.id,
              username: target.username,
            },
            options
          );
          await loadHistory();
        })();
      }
    },
    [loadHistory, options, user]
  );

  const onOpenPost = useCallback(
    (target: SearchPostResult) => {
      if (user) {
        void (async () => {
          await recordSearchPost(
            {
              content: target.content,
              createdAt: target.createdAt,
              id: target.id,
            },
            options
          );
          await loadHistory();
        })();
      }
    },
    [loadHistory, options, user]
  );

  const submitSearch = useCallback(() => {
    const query = input.trim();
    if (!query) {
      return;
    }
    Keyboard.dismiss();
    setInput(query);
    if (user) {
      void (async () => {
        const resolved = options;
        const count =
          results.users.length +
          results.communities.length +
          results.posts.length;
        await recordSearchQuery(query, count, resolved);
        await loadHistory();
      })();
    }
  }, [input, loadHistory, options, results, user]);

  // A duplicate query is replaced rather than stacked, which is what web's
  // optimistic write does, so the list stays a set of distinct searches.
  const dropHistoryItem = useCallback(
    (key: string) => {
      setHistory((current) => current.filter((entry) => entry.key !== key));
      if (user) {
        void (async () => {
          await removeSearchHistoryItem(key, options);
        })();
      }
    },
    [options, user]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (user) {
      void (async () => {
        await clearSearchHistory(options);
      })();
    }
  }, [options, user]);

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
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
      <View style={styles.searchArea}>
        <View
          style={[
            styles.inputWrap,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <Search color={theme.dividerText} size={19} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onChangeText={setInput}
            onSubmitEditing={submitSearch}
            placeholder="Search on asocialmedia"
            placeholderTextColor={theme.inputPlaceholder}
            returnKeyType="search"
            style={[styles.input, { color: theme.inputText }]}
            value={input}
          />
          {input ? (
            <Pressable
              accessibilityLabel="Clear search"
              onPress={() => setInput("")}
            >
              <X color={theme.dividerText} size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <FeedTabs
        active="search"
        fill
        onChange={(value) => setInput(value)}
        tabs={[{ label: "Search", value: "search" }]}
      />
      {loading ? (
        <ActivityIndicator color="#ff9500" style={styles.loader} />
      ) : null}
      {error ? (
        <View style={styles.center}>
          <Text style={[styles.error, { color: theme.dividerText }]}>
            {error}
          </Text>
          <Pressable onPress={() => setInput(input)} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && hasQuery && !hasResults ? (
        <View style={styles.center}>
          <Search color={theme.dividerText} size={34} />
          <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
            No results found
          </Text>
          <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
            Try another username, post, or community.
          </Text>
        </View>
      ) : null}
      {!hasQuery && history.length > 0 ? (
        <View style={styles.historyList}>
          <View style={styles.historyHead}>
            <Text style={[styles.historyTitle, { color: theme.dividerText }]}>
              Recent
            </Text>
            <Pressable
              accessibilityLabel="Clear search history"
              accessibilityRole="button"
              hitSlop={8}
              onPress={clearHistory}
            >
              <Text style={[styles.historyClear, { color: theme.dividerText }]}>
                Clear all
              </Text>
            </Pressable>
          </View>
          {history.map((entry) => (
            <Pressable
              key={entry.key}
              onPress={() => {
                if (entry.item.type === "query") {
                  setInput(entry.item.query);
                  return;
                }
                if (entry.item.type === "user") {
                  router.push({
                    params: { username: entry.item.user.username },
                    pathname: "/users/[username]",
                  });
                  return;
                }
                router.push({
                  params: { postId: entry.item.post.id },
                  pathname: "/posts/[postId]",
                });
              }}
              style={({ pressed }) => [
                styles.historyRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <HistoryGlyph item={entry.item} />
              <Text
                numberOfLines={1}
                style={[styles.historyLabel, { color: theme.inputText }]}
              >
                {historyItemLabel(entry.item)}
              </Text>
              <Pressable
                accessibilityLabel={`Remove ${historyItemLabel(entry.item)} from search history`}
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  dropHistoryItem(entry.key);
                }}
              >
                <X color={theme.dividerText} size={16} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!hasQuery && history.length === 0 ? (
        <View style={styles.center}>
          <Search color={theme.dividerText} size={34} />
          <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
            Search asocialmedia
          </Text>
          <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
            Find people, posts, and communities.
          </Text>
        </View>
      ) : null}
      {hasResults ? (
        <FlatList
          contentContainerStyle={styles.list}
          data={[...results.users, ...results.communities, ...results.posts]}
          keyExtractor={(item) => {
            if ("username" in item) {
              return `user-${item.id}`;
            }
            if ("slug" in item) {
              return `community-${item.id}`;
            }
            return `post-${item.id}`;
          }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            if ("username" in item) {
              return <UserResult onOpen={onOpenUser} user={item} />;
            }
            if ("slug" in item) {
              return <CommunityResult community={item} />;
            }
            return <PostResult onOpen={onOpenPost} post={item} />;
          }}
          showsVerticalScrollIndicator={false}
        />
      ) : suggestions.length > 0 && hasQuery ? (
        <View style={styles.suggestionList}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.query}
              onPress={() => setInput(suggestion.query)}
              style={styles.suggestion}
            >
              <Clock3 color={theme.dividerText} size={16} />
              <Text style={[styles.suggestionText, { color: theme.inputText }]}>
                {suggestion.query}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    gap: 10,
    justifyContent: "center",
    padding: 32,
  },
  communityAvatar: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  emptyBody: { fontFamily: "SofiaProReg", fontSize: 14, textAlign: "center" },
  emptyTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  error: { fontFamily: "SofiaProReg", fontSize: 15, textAlign: "center" },
  historyClear: { fontFamily: "SofiaProMed", fontSize: 13 },
  historyHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  historyLabel: { flex: 1, fontFamily: "SofiaProReg", fontSize: 14 },
  historyList: { paddingTop: 4 },
  historyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  historyTitle: { fontFamily: "SofiaProMed", fontSize: 13 },
  input: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  inputWrap: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  list: { gap: 8, padding: 12, paddingBottom: 32 },
  loader: { marginTop: 18 },
  metaText: { fontFamily: "SofiaProReg", fontSize: 12 },
  postContent: { fontFamily: "SofiaProMed", fontSize: 14, lineHeight: 19 },
  postMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 5,
  },
  preview: { borderRadius: 10, height: 54, width: 54 },
  retry: {
    borderColor: "#ff9500",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: { color: "#ff9500", fontFamily: "SofiaProMed", fontSize: 14 },
  root: { flex: 1 },
  row: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 64,
    padding: 10,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowMeta: { alignItems: "center", flexDirection: "row", gap: 4 },
  rowSubtitle: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 3 },
  rowTitle: { fontFamily: "SofiaProBold", fontSize: 14 },
  searchArea: { paddingHorizontal: 12, paddingVertical: 10 },
  suggestion: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  suggestionList: { paddingTop: 4 },
  suggestionText: { fontFamily: "SofiaProReg", fontSize: 14 },
});
