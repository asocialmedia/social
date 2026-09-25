// oxlint-disable no-nested-ternary, curly, unicorn/no-nested-ternary, no-negated-condition, unicorn/no-negated-condition, react/todo, react/set-state-in-effect, unicorn/no-useless-undefined
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Clock3, Flame, Search, Users, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
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
import { fetchSearchSuggestions, fetchSpotlight } from "../lib/search-api";
import type {
  SearchCommunityResult,
  SearchPostResult,
  SearchSuggestion,
  SearchUserResult,
  SpotlightResponse,
} from "../lib/search-api";

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

function UserResult({ user }: { user: SearchUserResult }) {
  const router = useRouter();
  return (
    <ResultRow
      onPress={() =>
        router.push({
          params: { username: user.username },
          pathname: "/users/[username]",
        })
      }
    >
      <UserAvatar size={40} url={user.avatarUrl} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: "#fff" }]}>
          {user.displayName}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: "#aaa" }]}>
          @{user.username}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <Flame color="#ff9500" fill="#ff9500" size={14} />
        <Text style={[styles.metaText, { color: "#aaa" }]}>{user.aura}</Text>
      </View>
    </ResultRow>
  );
}

function CommunityResult({ community }: { community: SearchCommunityResult }) {
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
        <Text numberOfLines={1} style={[styles.rowTitle, { color: "#fff" }]}>
          {community.name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: "#aaa" }]}>
          a/{community.slug} · {community.memberCount} members
        </Text>
      </View>
    </ResultRow>
  );
}

function PostResult({ post }: { post: SearchPostResult }) {
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
      onPress={() =>
        router.push({
          params: { postId: post.id },
          pathname: "/posts/[postId]",
        })
      }
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

export function SearchScreen() {
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const [input, setInput] = useState("");
  const [results, setResults] = useState<SpotlightResponse>(EMPTY_RESULTS);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          const cookie = user ? await authClient.getCookie() : undefined;
          const options = { apiBase: getApiBaseUrl(), cookie };
          const [nextResults, nextSuggestions] = await Promise.all([
            fetchSpotlight(query, options),
            fetchSearchSuggestions(query, options),
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
  }, [input, user]);

  const hasQuery = input.trim().length > 0;
  const hasResults = useMemo(
    () =>
      results.communities.length + results.posts.length + results.users.length >
      0,
    [results]
  );
  const submitSearch = () => {
    const query = input.trim();
    if (!query) {
      return;
    }
    Keyboard.dismiss();
    setInput(query);
  };

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
      {!hasQuery ? (
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
              return <UserResult user={item} />;
            }
            if ("slug" in item) {
              return <CommunityResult community={item} />;
            }
            return <PostResult post={item} />;
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
