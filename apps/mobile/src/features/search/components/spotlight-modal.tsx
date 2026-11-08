// Floating spotlight search modal: native port of web's Spotlight at phone
// width (apps/web/src/components/search/spotlight.tsx). The card is the
// `.panel-3d` floating surface (panel3d in components/surface/recipes.ts),
// re-themed to the `.bluesky-3d-surface` gradient while searching Bluesky.
// It carries the title, the Both/ASM/Bluesky switcher, the Filters and Clear
// history track, the search field and a results list. An empty query shows
// "Your interests", "Recent", "Suggested accounts" and "Suggested posts"; a
// query of two or more characters shows Accounts, Posts and Communities.
// oxlint-disable react/set-state-in-effect
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { ChevronDown, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  iconButton,
  panel3d,
  premiumInput,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { BlueskyIcon } from "@/features/feed/components/bluesky-icon";
import { nativeNetworkPath } from "@/features/network/lib/network-paths";
import {
  learnNetworkSearch,
  useDiscoverySuggestions,
} from "@/features/network/state/use-discovery-suggestions";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { PROD_API_URL } from "@/lib/network/api-base";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { recentNetworkSearchScope } from "../lib/recent-search-scope";
import {
  clearSearchHistory,
  fetchSearchHistoryRaw,
  recordSearchPost,
  recordSearchQuery,
  recordSearchUser,
  removeSearchHistoryItem,
} from "../lib/search-api";
import { historyItemKey, parseHistoryItem } from "../lib/search-history";
import type { SearchKind, SearchSource } from "../lib/search-scope";
import {
  emptySearchCopy,
  matchingServerEntry,
  mergeRecentHistory,
  searchPlaceholder,
  searchSubtitle,
  searchTitle,
  spotlightGroups,
  spotlightInterests,
  spotlightResultItems,
  spotlightTarget,
  suggestedItems,
} from "../lib/spotlight-items";
import type {
  ServerHistoryEntry,
  SpotlightResultItem,
} from "../lib/spotlight-items";
import { useSearchStore } from "../state/search-store";
import { useNetworkSearch } from "../state/use-network-search";
import { useRecentNetworkSearches } from "../state/use-recent-network-searches";
import { ActionTrack, FilterMenu, SourceSwitcher } from "./spotlight-controls";
import {
  blueskySurface,
  chipFlat,
  spotlightPalette,
} from "./spotlight-recipes";
import {
  EmptySearch,
  GroupHeader,
  SearchRow,
  SearchSkeleton,
} from "./spotlight-rows";
import { SuggestedAccountsRail } from "./suggested-accounts-rail";

export type { SpotlightResultItem } from "../lib/spotlight-items";

// The Bluesky field's inset well and focus ring, from web's input classes.
const BLUE_INPUT_SHADOWS =
  "inset 0 2px 4px rgba(0, 0, 0, 0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.15), 0 1px 1px rgba(255, 255, 255, 0.2)";
const BLUE_INPUT_FOCUS_SHADOWS =
  "inset 0 2px 4px rgba(0, 0, 0, 0.15), 0 0 0 1px #ffffff, 0 0 0 4px rgba(255, 255, 255, 0.35)";

export function SpotlightModal() {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const router = useRouter();

  const isOpen = useSearchStore((state) => state.isOpen);
  const initialQuery = useSearchStore((state) => state.initialQuery);
  const close = useSearchStore((state) => state.close);

  const { user } = useSessionContext();
  const viewer = user?.id ?? "guest";
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState<SearchSource>("all");
  const [kind, setKind] = useState<SearchKind>("all");
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [controlsBottom, setControlsBottom] = useState(0);
  const search = useNetworkSearch(query, source, kind, isOpen);
  const { network } = search;
  const recent = useRecentNetworkSearches(
    recentNetworkSearchScope(
      viewer,
      network.settings.preferences.activeProfileId
    )
  );
  const recommendations = useDiscoverySuggestions(isOpen && Boolean(user));
  const [history, setHistory] = useState<ServerHistoryEntry[]>([]);
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
    // Web mounts a fresh Spotlight per open, so every open starts on Both
    // networks, Everything, interests collapsed. The modal here stays
    // mounted, so the reset is explicit.
    const opening = isOpen && seedInputs?.open !== true;
    setSeedInputs({ initialQuery, open: isOpen });
    if (isOpen) {
      setQuery(initialQuery ?? "");
      setFiltersOpen(false);
    }
    if (opening) {
      setSource("all");
      setKind("all");
      setInterestsOpen(false);
    }
  }

  const inputRef = useRef<TextInputInstance>(null);
  const collectedSignature = useRef("");
  const historyRequest = useRef(0);
  const learnedQuery = useRef("");

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
    // Only the newest request may write: the cookie arrives after the first
    // open render, so two loads can race and an older reply must not win.
    historyRequest.current += 1;
    const request = historyRequest.current;
    try {
      const raw = await fetchSearchHistoryRaw(options);
      if (request !== historyRequest.current) {
        return;
      }
      setHistory(
        raw.flatMap((entry) => {
          const item = parseHistoryItem(entry);
          return item ? [{ item, key: historyItemKey(item, entry) }] : [];
        })
      );
    } catch {
      // Web keeps the cached history when a refetch fails, so the Recent
      // list never blanks out on a flaky connection.
    }
  }, [options, user]);

  useEffect(() => {
    if (isOpen) {
      void loadHistory();
    }
  }, [isOpen, loadHistory]);

  const trimmed = query.trim();
  const blue = source === "bluesky";
  const includesBluesky = source !== "asm" && kind !== "community";
  const results = spotlightResultItems(
    blue ? undefined : search.asm,
    includesBluesky ? search.bluesky : undefined,
    kind
  );
  const fetching =
    (!blue && search.asmLoading) || (includesBluesky && search.remoteLoading);
  const unavailable = includesBluesky ? search.bluesky.unavailable : [];
  const errors = [
    ...(!blue && search.asmError
      ? [{ label: "asocialmedia", message: search.asmError }]
      : []),
    ...(includesBluesky && search.remoteError && unavailable.length === 0
      ? [{ label: "Bluesky", message: search.remoteError }]
      : []),
  ];

  // Results a query surfaced become guest suggestions, as web's collect().
  useEffect(() => {
    if (trimmed.length < 2 || fetching || results.length === 0) {
      return;
    }
    const signature = `${trimmed}\n${results.map((item) => item.id).join("\n")}`;
    if (collectedSignature.current === signature) {
      return;
    }
    collectedSignature.current = signature;
    recent.collect(
      results.flatMap((item) => {
        const target = spotlightTarget(item);
        return target ? [target] : [];
      }),
      trimmed
    );
  });

  // Signed-in searches teach the recommender once results settle, once per
  // query so a preference revision that re-runs the search cannot loop.
  const hasResults = results.length > 0;
  useEffect(() => {
    if (!user || trimmed.length < 2 || fetching || !hasResults) {
      return;
    }
    const learnKey = `${viewer}:${trimmed.toLowerCase()}`;
    if (learnedQuery.current === learnKey) {
      return;
    }
    const timer = setTimeout(() => {
      learnedQuery.current = learnKey;
      void learnNetworkSearch(viewer, trimmed);
    }, 1000);
    return () => clearTimeout(timer);
  }, [user, viewer, trimmed, fetching, hasResults]);

  const recentItems = recent.items;
  const recentHistory = useMemo(
    () => mergeRecentHistory(recentItems, history, source, kind),
    [recentItems, history, source, kind]
  );
  const suggested = suggestedItems({
    candidates: recent.candidates,
    data: recommendations.data,
    kind,
    local: recentItems,
    signedIn: Boolean(user),
    source,
  });
  const groups = spotlightGroups(trimmed, results, recentHistory, suggested);
  const items = groups.flatMap((group) => group.items);
  const interests = spotlightInterests(network.settings);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    setFiltersOpen(false);
    close();
  }, [close]);

  // Web always follows the result's href. A path the app has no screen for
  // opens on the web instead of leaving the tap with no response.
  const navigate = (href: string) => {
    const path = nativeNetworkPath(href);
    handleClose();
    if (path) {
      router.push(path as Href);
    } else if (href.startsWith("/") && !href.startsWith("//")) {
      void Linking.openURL(`${PROD_API_URL}${href}`);
    }
  };

  const select = (item: SpotlightResultItem) => {
    setFiltersOpen(false);
    if (item.type === "history") {
      setSource(item.searchSource ?? "all");
      setKind("all");
      setQuery(item.displayName);
      inputRef.current?.focus();
      return;
    }
    const target = spotlightTarget(item);
    if (target) {
      recent.remember(
        trimmed || target.subtitle || target.displayName,
        target.source,
        {
          avatarUrl: target.avatarUrl,
          explicit: target.explicitContent,
          href: target.href,
          id: target.id,
          label: target.displayName,
          subtitle: target.subtitle,
          type: target.type,
        },
        kind
      );
    }
    if (user && item.source) {
      const prefix = `${item.source}-user-`;
      const identity =
        item.type === "user" && item.id.startsWith(prefix)
          ? item.id.slice(prefix.length)
          : undefined;
      void learnNetworkSearch(
        viewer,
        trimmed || item.displayName.slice(0, 80),
        identity ? { id: identity, source: item.source } : undefined
      );
    }
    if (user && item.source === "asm") {
      const { rawPost, rawUser } = item;
      if (rawUser) {
        void (async () => {
          await recordSearchUser(
            {
              aura: rawUser.aura,
              avatarUrl: rawUser.avatarUrl,
              displayName: rawUser.displayName,
              id: rawUser.id,
              username: rawUser.username,
            },
            options
          );
          await loadHistory();
        })();
      } else if (rawPost) {
        void (async () => {
          await recordSearchPost(
            {
              aura: rawPost.aura,
              authorAvatarUrl: rawPost.authorAvatarUrl,
              authorUsername: rawPost.authorUsername,
              content: rawPost.content,
              createdAt: rawPost.createdAt,
              explicitContent: rawPost.explicitContent,
              id: rawPost.id,
              previewMedia: rawPost.previewMedia,
              viewCount: rawPost.viewCount,
            },
            options
          );
          await loadHistory();
        })();
      }
    }
    navigate(item.href);
  };

  // Web's Enter: open the first result, otherwise remember the query.
  const submit = () => {
    const [first] = items;
    if (trimmed.length >= 2 && first) {
      select(first);
      return;
    }
    if (trimmed.length < 2) {
      return;
    }
    Keyboard.dismiss();
    recent.remember(trimmed, source);
    if (user && !blue) {
      void (async () => {
        await recordSearchQuery(trimmed, results.length, options);
        await loadHistory();
      })();
    }
  };

  const remove = (item: SpotlightResultItem) => {
    if (item.localHistoryAt !== undefined) {
      void recent.remove(item.localHistoryAt);
    }
    if (user && item.source !== "bluesky") {
      const target =
        item.serverRemoveTarget ?? matchingServerEntry(item, history)?.key;
      if (target) {
        setHistory((current) =>
          current.filter((entry) => entry.key !== target)
        );
        void removeSearchHistoryItem(target, options);
      }
    }
  };

  const clearHistory = () => {
    setFiltersOpen(false);
    void recent.clear();
    if (user) {
      setHistory([]);
      void clearSearchHistory(options);
    }
  };

  const changeSource = (next: SearchSource) => {
    setSource(next);
    if (next === "bluesky" && kind === "community") {
      setKind("all");
    }
  };

  const retry = () => {
    search.retry();
  };

  if (!isOpen) {
    return null;
  }

  const palette = spotlightPalette(isDark, blue);
  const panel = panel3d(isDark);
  const field = premiumInput(isDark, inputFocused);
  const closeButton = iconButton(isDark);
  const chip = chipFlat(isDark, blue);
  const canClearHistory =
    !trimmed &&
    (recentItems.length > 0 ||
      history.length > 0 ||
      recent.candidates.length > 0);
  const empty = emptySearchCopy({
    errorCount: errors.length,
    fetching,
    itemCount: items.length,
    kind,
    trimmed,
  });
  const aside = user ? "Based on your activity" : "Based on your searches";
  const panelLayout = {
    maxHeight: window.height * 0.88,
  };

  let inputShadows = field.shadows;
  if (blue) {
    inputShadows = inputFocused ? BLUE_INPUT_FOCUS_SHADOWS : BLUE_INPUT_SHADOWS;
  }

  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <View style={styles.titleLine}>
            {blue ? <BlueskyIcon color="#ffffff" size={20} /> : null}
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: palette.foreground }]}
            >
              {searchTitle(source)}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[styles.subtitle, { color: palette.soft }]}
          >
            {searchSubtitle(source)}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={4}
          onPress={handleClose}
          style={[
            styles.closeButton,
            blue
              ? styles.closeButtonBlue
              : {
                  backgroundColor: closeButton.background,
                  boxShadow: closeButton.shadows,
                },
          ]}
        >
          <X color={blue ? "#ffffff" : closeButton.color} size={16} />
        </Pressable>

        <View
          onLayout={(event) => {
            const { height, y } = event.nativeEvent.layout;
            setControlsBottom(y + height);
          }}
          style={styles.controls}
        >
          <SourceSwitcher
            isDark={isDark}
            onChange={changeSource}
            palette={palette}
            source={source}
          />
          <ActionTrack
            canClearHistory={canClearHistory}
            isDark={isDark}
            kind={kind}
            onClearHistory={clearHistory}
            onToggleFilters={() => setFiltersOpen((current) => !current)}
            palette={palette}
          />
        </View>

        <View
          style={[
            styles.inputWrap,
            blue
              ? [
                  styles.inputBlue,
                  inputFocused ? styles.inputBlueFocused : null,
                ]
              : { backgroundColor: field.background },
            { boxShadow: inputShadows },
          ]}
        >
          <View pointerEvents="none" style={styles.inputIcon}>
            <Search
              color={blue ? "rgba(255, 255, 255, 0.9)" : palette.muted}
              size={20}
            />
          </View>
          <TextInput
            accessibilityLabel="Search"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={80}
            onBlur={() => setInputFocused(false)}
            onChangeText={setQuery}
            onFocus={() => {
              setInputFocused(true);
              setFiltersOpen(false);
            }}
            onSubmitEditing={submit}
            placeholder={searchPlaceholder(source)}
            placeholderTextColor={
              blue ? "rgba(255, 255, 255, 0.8)" : field.placeholder
            }
            ref={inputRef}
            returnKeyType="search"
            style={[styles.input, { color: blue ? "#ffffff" : field.text }]}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              style={({ pressed }) => [
                styles.clearButton,
                pressed ? { backgroundColor: palette.rowPressed } : null,
              ]}
            >
              <X
                color={blue ? "rgba(255, 255, 255, 0.85)" : palette.muted}
                size={16}
              />
            </Pressable>
          ) : null}
        </View>

        {trimmed.length >= 2 ? (
          <View style={styles.statusLine}>
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.statusText, { color: palette.soft }]}
            >
              {fetching ? "Searching…" : `${items.length} results`}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
        style={[styles.list, { borderTopColor: palette.divider }]}
      >
        {trimmed.length >= 2 &&
        (errors.length > 0 || unavailable.length > 0) ? (
          <View accessibilityLiveRegion="polite" style={styles.errors}>
            {errors.map(({ label, message }) => (
              <Text
                key={label}
                selectable
                style={[styles.errorText, { color: palette.muted }]}
              >
                {label}: {message}
              </Text>
            ))}
            {unavailable.length > 0 ? (
              <Text
                selectable
                style={[styles.errorText, { color: palette.muted }]}
              >
                Some Bluesky {unavailable.join(" and ")} are temporarily
                unavailable.
              </Text>
            ) : null}
            <Pressable accessibilityRole="button" hitSlop={6} onPress={retry}>
              <Text style={[styles.retryText, { color: palette.foreground }]}>
                Retry
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Your interests: collapsed by default so suggestions stay above the fold. */}
        {!trimmed && interests.length > 0 ? (
          <View
            style={
              interestsOpen ? styles.interestsOpen : styles.interestsClosed
            }
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: interestsOpen }}
              onPress={() => setInterestsOpen((expanded) => !expanded)}
              style={({ pressed }) => [
                styles.interestsToggle,
                pressed ? { backgroundColor: palette.rowPressed } : null,
              ]}
            >
              <Text
                style={[styles.interestsLabel, { color: palette.foreground }]}
              >
                Your interests
              </Text>
              <Text
                style={[
                  styles.interestsCount,
                  {
                    color: blue ? "rgba(255, 255, 255, 0.7)" : palette.muted,
                  },
                ]}
              >
                {interests.length}
              </Text>
              <View style={interestsOpen ? styles.chevronOpen : null}>
                <ChevronDown color={palette.foreground} size={14} />
              </View>
            </Pressable>
            {interestsOpen ? (
              <View style={styles.chips}>
                {interests.map((interest) => (
                  <Pressable
                    accessibilityRole="button"
                    key={interest}
                    onPress={() => {
                      setQuery(interest);
                      inputRef.current?.focus();
                    }}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: chip.background,
                        borderColor: chip.border,
                        boxShadow: chip.shadows,
                      },
                      pressed ? styles.chipPressed : null,
                    ]}
                  >
                    <Text
                      style={[styles.chipText, { color: palette.foreground }]}
                    >
                      {interest}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <View key={group.title} style={styles.group}>
              {group.title === "Suggested accounts" ? (
                <SuggestedAccountsRail
                  aside={aside}
                  isDark={isDark}
                  items={group.items}
                  onAuthRedirect={handleClose}
                  onSelect={select}
                  palette={palette}
                />
              ) : (
                <>
                  <GroupHeader
                    aside={
                      group.title === "Suggested posts" ? aside : undefined
                    }
                    palette={palette}
                    title={group.title}
                  />
                  <View style={styles.groupRows}>
                    {group.items.map((item) => (
                      <SearchRow
                        isDark={isDark}
                        item={item}
                        key={item.id}
                        onRemove={
                          group.title === "Recent"
                            ? () => remove(item)
                            : undefined
                        }
                        onSelect={() => select(item)}
                        palette={palette}
                      />
                    ))}
                  </View>
                </>
              )}
            </View>
          ))}

        {trimmed.length >= 2 && fetching && items.length === 0 ? (
          <SearchSkeleton palette={palette} />
        ) : null}

        {empty ? (
          <EmptySearch
            description={empty.description}
            palette={palette}
            title={empty.title}
          />
        ) : null}
      </ScrollView>

      {filtersOpen ? (
        <>
          <Pressable
            accessibilityLabel="Close filters"
            onPress={() => setFiltersOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.menuAnchor, { top: controlsBottom + 8 }]}>
            <FilterMenu
              isDark={isDark}
              kind={kind}
              onSelect={(next) => setKind(next)}
              palette={palette}
            />
          </View>
        </>
      ) : null}
    </>
  );

  const surface = blueskySurface(isDark);

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
              paddingTop: insets.top + Math.min(window.height * 0.06, 56),
            },
          ]}
        >
          {blue ? (
            <Gradient3D
              colors={surface.colors}
              radius={16}
              shadows={surface.shadows}
              style={[styles.panel, styles.panelBlue, panelLayout]}
            >
              {content}
            </Gradient3D>
          ) : (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: panel.background,
                  borderColor: panel.border,
                  boxShadow: panel.shadows,
                },
                panelLayout,
              ]}
            >
              {content}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
  },
  chevronOpen: {
    transform: [{ rotate: "180deg" }],
  },
  chip: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  chipPressed: {
    transform: [{ translateY: 1 }],
  },
  chipText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  clearButton: {
    alignItems: "center",
    borderRadius: 14,
    flexShrink: 0,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  closeButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 16,
    width: 36,
  },
  closeButtonBlue: {
    backgroundColor: "#0763d6",
    borderColor: "rgba(255, 255, 255, 0.5)",
    borderWidth: 1,
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  errorText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
  },
  errors: {
    gap: 4,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  fill: {
    flex: 1,
  },
  floatingWrap: {
    alignItems: "center",
    flex: 1,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  group: {
    marginBottom: 16,
  },
  groupRows: {
    gap: 4,
  },
  header: {
    flexShrink: 0,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  input: {
    backgroundColor: "transparent",
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 16,
    height: 48,
    minWidth: 0,
    padding: 0,
  },
  inputBlue: {
    backgroundColor: "#0763d6",
    borderColor: "rgba(255, 255, 255, 0.5)",
    borderWidth: 1,
  },
  inputBlueFocused: {
    borderColor: "#ffffff",
  },
  inputIcon: {
    flexShrink: 0,
    height: 20,
    width: 20,
  },
  inputWrap: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  interestsClosed: {
    marginBottom: 4,
  },
  interestsCount: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
  },
  interestsLabel: {
    fontFamily: "SofiaProBold",
    fontSize: 13,
  },
  interestsOpen: {
    marginBottom: 12,
  },
  interestsToggle: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    height: 28,
    paddingHorizontal: 6,
  },
  list: {
    borderTopWidth: 1,
    flexShrink: 1,
  },
  listContent: {
    minHeight: 256,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  menuAnchor: {
    position: "absolute",
    right: 16,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: 576,
    overflow: "hidden",
    width: "100%",
  },
  panelBlue: {
    alignItems: "stretch",
    borderColor: "rgba(255, 255, 255, 0.6)",
    justifyContent: "flex-start",
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  statusLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    minHeight: 20,
  },
  statusText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  subtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginTop: 2,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 15,
    letterSpacing: -0.2,
    lineHeight: 18,
  },
  titleBlock: {
    justifyContent: "center",
    minHeight: 36,
    paddingRight: 44,
  },
  titleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
