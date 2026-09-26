// Floating spotlight search modal: 1:1 native port of web's Spotlight
// (components/search/spotlight.tsx). Floats an apple-panel card under the
// top bar with a dimmed backdrop, instant debounced search for communities,
// people, and posts, search history with item removal and clear-all, empty states
// with nosearch.png, skeletons, and guest notice footer.
// oxlint-disable react/set-state-in-effect
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Clock3, Eye, Flame, Play, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import noSearchImage from "@/assets/images/nosearch.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { APPLE_PANEL_TOKENS, themeText } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { mediaGridImageUrl } from "@/features/feed/lib/media-url";
import {
  formatNumber,
  getAuraFlameStyle,
} from "@/features/home/components/profile-utils";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import {
  clearSearchHistory,
  fetchSearchHistoryRaw,
  fetchSpotlight,
  recordSearchPost,
  recordSearchQuery,
  recordSearchUser,
  removeSearchHistoryItem,
} from "../lib/search-api";
import type {
  SearchCommunityResult,
  SearchPostResult,
  SearchUserResult,
  SpotlightResponse,
} from "../lib/search-api";
import {
  formatSearchTime,
  historyItemKey,
  parseHistoryItem,
} from "../lib/search-history";
import type { SearchHistoryItem } from "../lib/search-history";
import { useSearchStore } from "../state/search-store";

const EMPTY_RESULTS: SpotlightResponse = {
  communities: [],
  posts: [],
  users: [],
};

export interface SpotlightResultItem {
  aura?: number;
  authorUsername?: string;
  avatarUrl?: string | null;
  createdAt?: string;
  displayName: string;
  explicitContent?: boolean;
  id: string;
  isSelf?: boolean;
  meta: string;
  previewMedia?: {
    id: string;
    thumbnailKey: string | null;
    type: string;
  } | null;
  rawCommunity?: SearchCommunityResult;
  rawPost?: SearchPostResult;
  rawUser?: SearchUserResult;
  removeTarget?: string;
  resultCount?: number;
  searchedAt?: number;
  subtitle?: string;
  type: "community" | "user" | "post" | "history";
  viewCount?: number;
}

function SpotlightSkeleton() {
  const { isDark } = useAppTheme();
  const bg = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
  const lineBg = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
  return (
    <View style={styles.skeletonRow}>
      <View style={[styles.skeletonAvatar, { backgroundColor: bg }]} />
      <View style={styles.skeletonCopy}>
        <View
          style={[styles.skeletonLine, { backgroundColor: bg, width: "35%" }]}
        />
        <View
          style={[
            styles.skeletonLine,
            { backgroundColor: lineBg, width: "65%" },
          ]}
        />
      </View>
    </View>
  );
}

export function SpotlightModal() {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  const rowPressedStyle = isDark
    ? styles.resultRowPressedDark
    : styles.resultRowPressedLight;
  const clearAllPressedStyle = isDark
    ? styles.clearAllBtnPressedDark
    : styles.clearAllBtnPressedLight;
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const router = useRouter();

  const isOpen = useSearchStore((state) => state.isOpen);
  const initialQuery = useSearchStore((state) => state.initialQuery);
  const close = useSearchStore((state) => state.close);

  const { user } = useSessionContext();
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SpotlightResponse>(EMPTY_RESULTS);
  const [history, setHistory] = useState<
    { item: SearchHistoryItem; key: string }[]
  >([]);
  const [cookie, setCookie] = useState<string | undefined>();

  // Mirrors last seen open/initialQuery so query is reseeded during render
  // without cascading effect re-renders.
  const [seedInputs, setSeedInputs] = useState<{
    initialQuery?: string;
    open: boolean;
  } | null>(null);

  if (
    seedInputs === null ||
    seedInputs.open !== isOpen ||
    seedInputs.initialQuery !== initialQuery
  ) {
    setSeedInputs({ initialQuery, open: isOpen });
    if (isOpen) {
      setQuery(initialQuery ?? "");
    }
  }

  const inputRef = useRef<TextInput>(null);

  // Read stored auth cookie for authenticated requests.
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

  // Load search history from API.
  const loadHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    try {
      const raw = await fetchSearchHistoryRaw(options);
      setHistory(
        raw.flatMap((entry) => {
          const item = parseHistoryItem(entry);
          return item ? [{ item, key: historyItemKey(item, entry) }] : [];
        })
      );
    } catch {
      setHistory([]);
    }
  }, [options, user]);

  useEffect(() => {
    if (isOpen) {
      void loadHistory();
    }
  }, [isOpen, loadHistory]);

  // Debounced search query fetching spotlight results.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !isOpen) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const nextResults = await fetchSpotlight(trimmed, options);
          if (!cancelled) {
            setResults(nextResults);
            setLoading(false);
          }
        } catch {
          if (!cancelled) {
            setResults(EMPTY_RESULTS);
            setLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, options, query]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    close();
  }, [close]);

  const handleSelectItem = useCallback(
    (item: SpotlightResultItem) => {
      if (item.type === "history") {
        setQuery(item.displayName);
        return;
      }
      if (item.type === "community" && item.rawCommunity) {
        handleClose();
        router.push({
          params: { slug: item.rawCommunity.slug },
          pathname: "/a/[slug]",
        });
        return;
      }
      if (item.type === "user" && item.rawUser) {
        handleClose();
        if (user) {
          void (async () => {
            await recordSearchUser(
              {
                aura: item.rawUser?.aura,
                avatarUrl: item.rawUser?.avatarUrl,
                displayName: item.rawUser?.displayName,
                id: item.rawUser?.id ?? "",
                username: item.rawUser?.username ?? "",
              },
              options
            );
            await loadHistory();
          })();
        }
        router.push({
          params: { username: item.rawUser.username },
          pathname: "/users/[username]",
        });
        return;
      }
      if (item.type === "post" && item.rawPost) {
        handleClose();
        if (user) {
          void (async () => {
            await recordSearchPost(
              {
                aura: item.rawPost?.aura,
                authorAvatarUrl: item.rawPost?.authorAvatarUrl,
                authorUsername: item.rawPost?.authorUsername,
                content: item.rawPost?.content ?? "",
                createdAt: item.rawPost?.createdAt ?? new Date().toISOString(),
                explicitContent: item.rawPost?.explicitContent,
                id: item.rawPost?.id ?? "",
                previewMedia: item.rawPost?.previewMedia,
                viewCount: item.rawPost?.viewCount,
              },
              options
            );
            await loadHistory();
          })();
        }
        const shortId =
          item.rawPost.id.length > 8
            ? item.rawPost.id.slice(0, 8)
            : item.rawPost.id;
        if (item.rawPost.isGust) {
          router.push({ params: { id: item.rawPost.id }, pathname: "/gusts" });
        } else {
          router.push({
            params: { postId: shortId },
            pathname: "/posts/[postId]",
          });
        }
      }
    },
    [handleClose, loadHistory, options, router, user]
  );

  const handleSubmitQuery = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    Keyboard.dismiss();
    if (user) {
      void (async () => {
        const count =
          results.communities.length +
          results.posts.length +
          results.users.length;
        await recordSearchQuery(trimmed, count, options);
        await loadHistory();
      })();
    }
  }, [loadHistory, options, query, results, user]);

  const handleRemoveHistoryItem = useCallback(
    (key: string) => {
      setHistory((current) => current.filter((entry) => entry.key !== key));
      if (user) {
        void removeSearchHistoryItem(key, options);
      }
    },
    [options, user]
  );

  const handleClearAllHistory = useCallback(() => {
    setHistory([]);
    if (user) {
      void clearSearchHistory(options);
    }
  }, [options, user]);

  const handleLogin = useCallback(() => {
    handleClose();
    router.push("/(auth)/login");
  }, [handleClose, router]);

  // Builds unified search result items matching web's Spotlight.buildItems.
  const buildItems = useCallback((): SpotlightResultItem[] => {
    const items: SpotlightResultItem[] = [];

    for (const community of results.communities) {
      items.push({
        avatarUrl: community.avatarUrl,
        displayName: community.name,
        id: `community-${community.id}`,
        meta: `${formatNumber(community.memberCount)} members`,
        rawCommunity: community,
        subtitle: `a/${community.slug}`,
        type: "community",
      });
    }

    for (const suggestion of results.users) {
      const isSelf = Boolean(
        user &&
        (suggestion.id === user.id ||
          (user.username &&
            suggestion.username.toLowerCase() === user.username.toLowerCase()))
      );
      items.push({
        avatarUrl: suggestion.avatarUrl,
        displayName: suggestion.displayName || suggestion.username,
        id: `user-${suggestion.id}`,
        isSelf,
        meta: `${formatNumber(suggestion.aura ?? 0)} aura`,
        rawUser: suggestion,
        subtitle: `@${suggestion.username}`,
        type: "user",
      });
    }

    for (const post of results.posts) {
      items.push({
        aura: post.aura,
        authorUsername: post.authorUsername,
        avatarUrl: post.authorAvatarUrl,
        createdAt: post.createdAt,
        displayName: post.content,
        explicitContent: post.explicitContent,
        id: `post-${post.id}`,
        meta: `${formatNumber(post.aura)} aura · ${formatNumber(post.viewCount)} views`,
        previewMedia: post.previewMedia,
        rawPost: post,
        subtitle: undefined,
        type: "post",
        viewCount: post.viewCount,
      });
    }

    return items;
  }, [results, user]);

  // Builds history suggestions matching web's Spotlight.buildSuggestions.
  const buildSuggestions = useCallback(
    (queryPrefix: string): SpotlightResultItem[] => {
      const items: SpotlightResultItem[] = [];
      const q = queryPrefix.trim().toLowerCase();

      for (const { item, key } of history) {
        const removeTarget = key;
        if (item.type === "user") {
          const username = item.user.username || "";
          const match =
            !q ||
            username.toLowerCase().includes(q) ||
            (item.user.displayName &&
              item.user.displayName.toLowerCase().includes(q));
          if (match) {
            const isSelf = Boolean(
              user &&
              (item.user.id === user.id ||
                (user.username &&
                  username.toLowerCase() === user.username.toLowerCase()))
            );
            const searchTimeStr = item.searchedAt
              ? formatSearchTime(item.searchedAt)
              : "";
            const rawUser: SearchUserResult = {
              aura: item.user.aura ?? 0,
              avatarUrl: item.user.avatarUrl ?? null,
              badge: null,
              badges: [],
              bio: null,
              displayName: item.user.displayName || username,
              id: item.user.id,
              username: item.user.username,
            };
            items.push({
              avatarUrl: item.user.avatarUrl,
              displayName: item.user.displayName || username || "Anonymous",
              id: `history-user-${item.user.id}-${key}`,
              isSelf,
              meta: `${formatNumber(item.user.aura ?? 0)} aura`,
              rawUser,
              removeTarget,
              searchedAt: item.searchedAt,
              subtitle: searchTimeStr
                ? `@${username} · ${searchTimeStr}`
                : `@${username}`,
              type: "user",
            });
          }
        } else if (item.type === "post") {
          const match =
            !q ||
            item.post.content.toLowerCase().includes(q) ||
            (item.post.authorUsername &&
              item.post.authorUsername.toLowerCase().includes(q));
          if (match) {
            const rawPost: SearchPostResult = {
              aura: item.post.aura ?? 0,
              authorAvatarUrl: item.post.authorAvatarUrl ?? null,
              authorDisplayName: "",
              authorUsername: item.post.authorUsername ?? "someone",
              content: item.post.content,
              createdAt: item.post.createdAt,
              explicitContent: item.post.explicitContent ?? false,
              id: item.post.id,
              isGust: false,
              previewMedia: item.post.previewMedia ?? null,
              viewCount: item.post.viewCount ?? 0,
            };
            items.push({
              aura: item.post.aura ?? 0,
              authorUsername: item.post.authorUsername ?? undefined,
              avatarUrl: item.post.authorAvatarUrl,
              createdAt: item.post.createdAt,
              displayName: item.post.content,
              explicitContent: item.post.explicitContent,
              id: `history-post-${item.post.id}-${key}`,
              meta: `${formatNumber(item.post.aura ?? 0)} aura · ${formatNumber(item.post.viewCount ?? 0)} views`,
              previewMedia: item.post.previewMedia,
              rawPost,
              removeTarget,
              searchedAt: item.searchedAt,
              subtitle: undefined,
              type: "post",
              viewCount: item.post.viewCount ?? 0,
            });
          }
        } else if (item.type === "query") {
          const match = !q || item.query.toLowerCase().includes(q);
          if (match) {
            const metaParts = [
              typeof item.resultCount === "number"
                ? `${formatNumber(item.resultCount)} results`
                : null,
              item.searchedAt
                ? formatSearchTime(item.searchedAt)
                : "Recent search",
            ].filter(Boolean);

            items.push({
              displayName: item.query,
              id: `history-query-${item.query}-${key}`,
              meta: metaParts.join(" · "),
              removeTarget,
              resultCount: item.resultCount,
              searchedAt: item.searchedAt,
              type: "history",
            });
          }
        }
      }

      return items;
    },
    [history, user]
  );

  if (!isOpen) {
    return null;
  }

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const items = hasQuery ? buildItems() : buildSuggestions(query);
  const hasItems = items.length > 0;

  const dividerBorderColor = isDark
    ? "rgba(255, 255, 255, 0.08)"
    : "rgba(0, 0, 0, 0.08)";

  const renderResultIcon = (item: SpotlightResultItem) => {
    if (item.type === "community" && item.rawCommunity) {
      return <CommunityAvatar community={item.rawCommunity} size={36} />;
    }
    if (item.type === "user" || item.type === "post") {
      return <UserAvatar radius={10} size={36} url={item.avatarUrl} />;
    }
    return (
      <View
        style={[
          styles.historyIconBox,
          {
            backgroundColor: isDark
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(0, 0, 0, 0.05)",
          },
        ]}
      >
        <Clock3 color={text.muted} size={16} />
      </View>
    );
  };

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={handleClose}
      statusBarTranslucent
      transparent
      visible={isOpen}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <Pressable
          accessibilityLabel="Close search"
          onPress={handleClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />

        <View
          pointerEvents="box-none"
          style={[
            styles.floatingWrap,
            {
              paddingTop: insets.top + (Platform.OS === "ios" ? 14 : 24),
            },
          ]}
        >
          <View
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
                maxHeight: window.height * 0.76,
              },
            ]}
          >
            {/* Search Input Bar */}
            <View
              style={[
                styles.inputRow,
                { borderBottomColor: dividerBorderColor },
              ]}
            >
              <Search color={text.muted} size={20} />
              <TextInput
                accessibilityLabel="Search people, posts, and communities"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={setQuery}
                onSubmitEditing={handleSubmitQuery}
                placeholder="Search people, posts, and communities"
                placeholderTextColor={
                  isDark ? "rgba(232, 232, 232, 0.4)" : "#8e8e93"
                }
                ref={inputRef}
                returnKeyType="search"
                style={[styles.input, { color: text.foreground }]}
                value={query}
              />
              {query.length > 0 ? (
                <Pressable
                  accessibilityLabel="Clear search text"
                  hitSlop={8}
                  onPress={() => setQuery("")}
                  style={styles.clearBtn}
                >
                  <X color={text.muted} size={16} />
                </Pressable>
              ) : null}
            </View>

            {/* Scrollable Results & History Container */}
            <ScrollView
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Skeletons on loading */}
              {loading && hasQuery ? (
                <View style={styles.resultsGroup}>
                  <SpotlightSkeleton />
                  <SpotlightSkeleton />
                  <SpotlightSkeleton />
                </View>
              ) : null}

              {/* No results empty state */}
              {!loading && hasQuery && !hasItems ? (
                <View style={styles.emptyWrap}>
                  <Image
                    contentFit="contain"
                    source={noSearchImage}
                    style={styles.emptyImage}
                  />
                  <Text style={[styles.emptyTitle, { color: text.foreground }]}>
                    No results for &quot;{query}&quot;
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: text.muted }]}>
                    Try a different name or topic
                  </Text>
                </View>
              ) : null}

              {/* Search Results / Suggestions */}
              {!loading && hasItems ? (
                <View style={styles.resultsGroup}>
                  {!hasQuery && history.length > 0 ? (
                    <View style={styles.historyHeader}>
                      <Text
                        style={[styles.historyTitle, { color: text.muted }]}
                      >
                        Recent searches
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={6}
                        onPress={handleClearAllHistory}
                        style={({ pressed }) => [
                          styles.clearAllBtn,
                          pressed ? clearAllPressedStyle : null,
                        ]}
                      >
                        <Text
                          style={[styles.clearAllText, { color: text.muted }]}
                        >
                          Clear all
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {items.map((item) => {
                    const isPost = item.type === "post";
                    const preview =
                      isPost && item.previewMedia
                        ? mediaGridImageUrl(getApiBaseUrl(), {
                            id: item.previewMedia.id,
                            mimeType: null,
                            thumbnailKey: item.previewMedia.thumbnailKey,
                            type: item.previewMedia.type,
                          })
                        : null;

                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={item.id}
                        onPress={() => handleSelectItem(item)}
                        style={({ pressed }) => [
                          styles.resultRow,
                          isPost ? styles.postRow : null,
                          pressed ? rowPressedStyle : null,
                        ]}
                      >
                        {renderResultIcon(item)}

                        <View style={styles.rowCopy}>
                          <View style={styles.titleRow}>
                            <Text
                              numberOfLines={isPost ? 3 : 1}
                              style={[
                                isPost ? styles.postContent : styles.rowTitle,
                                { color: text.foreground },
                              ]}
                            >
                              {item.displayName}
                            </Text>
                            {item.isSelf ? (
                              <View style={styles.selfBadge}>
                                <Text style={styles.selfBadgeText}>You</Text>
                              </View>
                            ) : null}
                          </View>

                          {isPost ? (
                            <View style={styles.postMetaRow}>
                              {item.authorUsername ? (
                                <Text
                                  numberOfLines={1}
                                  style={[
                                    styles.postMetaText,
                                    { color: text.muted },
                                  ]}
                                >
                                  @{item.authorUsername}
                                </Text>
                              ) : null}
                              {typeof item.aura === "number" ? (
                                <View style={styles.statChip}>
                                  {(() => {
                                    const flame = getAuraFlameStyle(
                                      item.aura ?? 0
                                    );
                                    return (
                                      <Flame
                                        color={flame.color}
                                        fill={
                                          flame.filled ? flame.color : "none"
                                        }
                                        size={12}
                                      />
                                    );
                                  })()}
                                  <Text
                                    style={[
                                      styles.postMetaText,
                                      { color: text.muted },
                                    ]}
                                  >
                                    {formatNumber(item.aura)}
                                  </Text>
                                </View>
                              ) : null}
                              {typeof item.viewCount === "number" ? (
                                <View style={styles.statChip}>
                                  <Eye color={text.muted} size={12} />
                                  <Text
                                    style={[
                                      styles.postMetaText,
                                      { color: text.muted },
                                    ]}
                                  >
                                    {formatNumber(item.viewCount)}
                                  </Text>
                                </View>
                              ) : null}
                              {item.createdAt ? (
                                <Text
                                  style={[
                                    styles.postMetaText,
                                    { color: text.muted },
                                  ]}
                                >
                                  {formatRelativeDate(item.createdAt)}
                                </Text>
                              ) : null}
                              {item.searchedAt ? (
                                <Text
                                  style={[
                                    styles.postMetaText,
                                    { color: text.muted },
                                  ]}
                                >
                                  · {formatSearchTime(item.searchedAt)}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}

                          {!isPost && item.subtitle ? (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.rowSubtitle,
                                { color: text.muted },
                              ]}
                            >
                              {item.subtitle}
                            </Text>
                          ) : null}
                        </View>

                        {isPost && preview ? (
                          <View
                            style={[
                              styles.previewWrap,
                              {
                                backgroundColor: isDark
                                  ? "rgba(255, 255, 255, 0.08)"
                                  : "rgba(0, 0, 0, 0.06)",
                              },
                            ]}
                          >
                            <Image
                              contentFit="cover"
                              source={{ uri: preview }}
                              style={[
                                styles.previewImage,
                                item.explicitContent
                                  ? styles.previewBlurred
                                  : null,
                              ]}
                            />
                            {item.previewMedia?.type === "VIDEO" ? (
                              <View style={styles.playBadgeWrap}>
                                <View style={styles.playBadge}>
                                  <Play
                                    color="#1c1f26"
                                    fill="#1c1f26"
                                    size={8}
                                  />
                                </View>
                              </View>
                            ) : null}
                          </View>
                        ) : null}

                        {isPost ? null : (
                          <Text
                            numberOfLines={1}
                            style={[styles.rowMeta, { color: text.muted }]}
                          >
                            {item.meta}
                          </Text>
                        )}

                        {item.removeTarget ? (
                          <Pressable
                            accessibilityLabel="Remove from history"
                            hitSlop={6}
                            onPress={(e) => {
                              e.stopPropagation();
                              if (item.removeTarget) {
                                handleRemoveHistoryItem(item.removeTarget);
                              }
                            }}
                            style={styles.removeBtn}
                          >
                            <X color={text.muted} size={14} />
                          </Pressable>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {/* Initial empty state (no query and no history) */}
              {!hasQuery && !hasItems ? (
                <View style={styles.emptyWrap}>
                  <Image
                    contentFit="contain"
                    source={noSearchImage}
                    style={styles.emptyImageLarge}
                  />
                  <Text style={[styles.emptyTitle, { color: text.foreground }]}>
                    Search asocialmedia
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: text.muted }]}>
                    Start typing to find people, posts, and communities
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            {/* Guest notice footer */}
            {user ? null : (
              <View
                style={[
                  styles.guestFooter,
                  { borderTopColor: dividerBorderColor },
                ]}
              >
                <Text style={[styles.guestText, { color: text.muted }]}>
                  Search is limited for guests. Log in for the full experience.
                </Text>
                <Pressable hitSlop={6} onPress={handleLogin}>
                  <Text style={styles.loginLink}>Log in</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.48)",
  },
  clearAllBtn: {
    borderColor: "transparent",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  clearAllBtnPressedDark: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  clearAllBtnPressedLight: {
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderColor: "rgba(0, 0, 0, 0.08)",
  },
  clearAllText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  clearBtn: {
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  emptyImage: {
    height: 96,
    marginBottom: 8,
    width: 96,
  },
  emptyImageLarge: {
    height: 112,
    marginBottom: 8,
    width: 112,
  },
  emptySubtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    textAlign: "center",
  },
  emptyTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    marginBottom: 4,
    textAlign: "center",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  fill: {
    flex: 1,
  },
  floatingWrap: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: 16,
  },
  guestFooter: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  guestText: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
  },
  historyHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 2,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  historyIconBox: {
    alignItems: "center",
    borderRadius: 8,
    flexShrink: 0,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  historyTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 16,
    height: "100%",
    paddingVertical: 0,
  },
  inputRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    height: 48,
    paddingHorizontal: 16,
  },
  listContent: {
    padding: 6,
  },
  loginLink: {
    color: "#ff9500",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 576,
    overflow: "hidden",
    width: "100%",
  },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 10,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.15)",
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  playBadgeWrap: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  postContent: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    lineHeight: 19,
  },
  postMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  postMetaText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  postRow: {
    alignItems: "flex-start",
    maxHeight: 88,
    overflow: "hidden",
    paddingVertical: 8,
  },
  previewBlurred: {
    opacity: 0.7,
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewWrap: {
    alignItems: "center",
    borderRadius: 8,
    flexShrink: 0,
    height: 48,
    justifyContent: "center",
    marginLeft: 8,
    overflow: "hidden",
    position: "relative",
    width: 48,
  },
  removeBtn: {
    alignItems: "center",
    borderRadius: 13,
    flexShrink: 0,
    height: 26,
    justifyContent: "center",
    marginLeft: 6,
    width: 26,
  },
  resultRow: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resultRowPressedDark: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    boxShadow:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 1px 1px rgba(255, 255, 255, 0.4)",
  },
  resultRowPressedLight: {
    backgroundColor: "#e4e7ec",
    borderColor: "rgba(0, 0, 0, 0.08)",
    boxShadow:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 1px 1px rgba(0, 0, 0, 0.05)",
  },
  resultsGroup: {
    gap: 2,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  rowMeta: {
    flexShrink: 0,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginLeft: 8,
  },
  rowSubtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  rowTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    lineHeight: 18,
  },
  selfBadge: {
    backgroundColor: "rgba(255, 149, 0, 0.12)",
    borderColor: "rgba(255, 149, 0, 0.25)",
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  selfBadgeText: {
    color: "#ff9500",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    lineHeight: 12,
  },
  skeletonAvatar: {
    borderRadius: 8,
    height: 36,
    width: 36,
  },
  skeletonCopy: {
    flex: 1,
    gap: 6,
  },
  skeletonLine: {
    borderRadius: 4,
    height: 10,
  },
  skeletonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statChip: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    overflow: "hidden",
  },
});
