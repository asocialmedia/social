// The list screen's search results: matching profiles first, then matching
// messages from every conversation, newest first.
//
// Ported from apps/web/src/components/messages/global-message-search-results.tsx
// and global-message-search-profiles.tsx. One FlatList owns the whole panel so a
// long result set is virtualized and keeps the keyboard up while tapping.
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Search,
  WifiOff,
} from "lucide-react-native";
import { useCallback, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import type { SearchUserResult } from "@/features/messages/lib/client";
import {
  globalSearchConversationAvatar,
  globalSearchConversationTitle,
  globalSearchResultLabel,
  globalSearchSenderLine,
  highlightSnippetParts,
  PROFILE_PREVIEW_LIMIT,
  rankProfileSearchResults,
  visibleProfileResults,
} from "@/features/messages/lib/global-message-search";
import type { GlobalMessageSearchResult } from "@/features/messages/lib/global-message-search";
import { formatListTimestamp } from "@/features/messages/lib/message-grouping";
import { chip3d } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

import { MessagesGrayButton, SearchRetryButton } from "./messages-gray-button";
import { mediaUrl, PressableRow } from "./messages-primitives";

// text-primary, and the 10% / 20% / 25% tints web layers from it.
const PRIMARY = "#f66b15";
const PRIMARY_10 = "rgba(246, 107, 21, 0.1)";
const PRIMARY_20 = "rgba(246, 107, 21, 0.2)";
const PRIMARY_25 = "rgba(246, 107, 21, 0.25)";

export interface GlobalMessageSearchResultsProps {
  coverageComplete: boolean;
  coveragePaused: boolean;
  creatingProfileId: string | null;
  error: string | null;
  focusMessageId: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  messageQueryValid: boolean;
  myUserId: string;
  onLoadMore: () => void;
  onProfileRetry: () => void;
  onProfileSelect: (profile: SearchUserResult) => void;
  onProfileToggleExpanded: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onSelect: (result: GlobalMessageSearchResult) => void;
  profileError: string | null;
  profileExpanded: boolean;
  profileLoading: boolean;
  profileRetryAt?: number;
  profiles: readonly SearchUserResult[];
  query: string;
  results: readonly GlobalMessageSearchResult[];
  retryAt?: number;
}

export function GlobalMessageSearchResults(
  props: GlobalMessageSearchResultsProps
) {
  const { isDark, theme } = useAppTheme();
  const listRef = useRef<FlatList<GlobalMessageSearchResult>>(null);
  const {
    error,
    focusMessageId,
    hasMore,
    loading,
    loadingMore,
    messageQueryValid,
    myUserId,
    onLoadMore,
    onRetry,
    onSelect,
    results,
    retryAt,
  } = props;
  const muted = isDark ? "#262626" : "#e5e5e5";
  const foreground = isDark ? "#eeeeee" : "#202020";

  const skipToMessages = useCallback(() => {
    if (results.length > 0) {
      listRef.current?.scrollToIndex({ animated: true, index: 0 });
    }
  }, [results.length]);

  const renderItem = useCallback(
    ({ item }: { item: GlobalMessageSearchResult }) => (
      <MessageResultRow
        focused={item.hit.id === focusMessageId}
        myUserId={myUserId}
        onSelect={onSelect}
        result={item}
      />
    ),
    [focusMessageId, myUserId, onSelect]
  );

  const header = (
    <View>
      <ProfilesSection {...props} onSkipToMessages={skipToMessages} />
      <View
        style={[styles.messagesSection, { borderTopColor: theme.dividerLine }]}
      >
        <View style={styles.sectionHeading}>
          <Text style={[styles.headingText, { color: foreground }]}>
            Messages
          </Text>
        </View>
        {messageQueryValid ? (
          <CoverageNotice {...props} />
        ) : (
          <Text style={[styles.note, { color: theme.dividerText }]}>
            Enter at least two characters to search messages.
          </Text>
        )}
        {messageQueryValid && results.length === 0 ? (
          <EmptyMessages {...props} muted={muted} />
        ) : null}
      </View>
    </View>
  );

  let footer: ReactElement | undefined;
  if (messageQueryValid && error && results.length > 0) {
    footer = (
      <View style={styles.inlineError}>
        <Text
          style={[styles.note, styles.flexNote, { color: theme.dividerText }]}
        >
          {error} Your loaded matches are still available.
        </Text>
        <SearchRetryButton onRetry={onRetry} retryAt={retryAt} />
      </View>
    );
  } else if (messageQueryValid && hasMore && !error) {
    footer = (
      <MessagesGrayButton
        disabled={loadingMore}
        label={loadingMore ? "Loading older results…" : "Load older results"}
        onPress={onLoadMore}
        style={styles.loadMore}
      >
        {loadingMore ? <ZephLoader size={14} variant="search" /> : null}
      </MessagesGrayButton>
    );
  }

  return (
    <FlatList
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Search results"
      contentContainerStyle={styles.content}
      data={messageQueryValid ? results : []}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => `${item.hit.conversationId}:${item.hit.id}`}
      ListFooterComponent={footer}
      ListHeaderComponent={header}
      onScrollToIndexFailed={(info) =>
        listRef.current?.scrollToOffset({
          animated: true,
          offset: Math.max(0, info.averageItemLength * info.index),
        })
      }
      ref={listRef}
      renderItem={renderItem}
      accessibilityState={{ busy: loading || loadingMore }}
    />
  );
}

function CoverageNotice({
  coverageComplete,
  coveragePaused,
  error,
  loading,
  onRefresh,
}: GlobalMessageSearchResultsProps) {
  const { theme } = useAppTheme();
  if (coverageComplete || loading || error) {
    return null;
  }
  const Icon = coveragePaused ? WifiOff : Search;
  return (
    <View style={[styles.coverage, { borderColor: theme.dividerLine }]}>
      <Icon color={theme.dividerText} size={14} />
      <Text
        style={[styles.note, styles.flexNote, { color: theme.dividerText }]}
      >
        {coveragePaused
          ? "Some older history is temporarily unavailable. Available matches appear below."
          : "Some older history is still being prepared. Available matches appear below."}
      </Text>
      <Text
        accessibilityRole="button"
        onPress={onRefresh}
        style={styles.refresh}
      >
        Refresh
      </Text>
    </View>
  );
}

function EmptyMessages({
  coverageComplete,
  error,
  loading,
  muted,
  onRetry,
  query,
  retryAt,
}: GlobalMessageSearchResultsProps & { muted: string }) {
  const { theme } = useAppTheme();
  if (error) {
    return (
      <View style={styles.centered}>
        <WifiOff color={theme.dividerText} size={20} />
        <Text style={[styles.centeredText, { color: theme.dividerText }]}>
          {error}
        </Text>
        <SearchRetryButton onRetry={onRetry} retryAt={retryAt} />
      </View>
    );
  }
  if (loading) {
    return (
      <View accessibilityLabel="Searching messages" style={styles.skeletons}>
        {[0, 1, 2, 3, 4].map((index) => (
          <View key={index} style={styles.messageSkeleton}>
            <View style={[styles.avatarSkeleton, { backgroundColor: muted }]} />
            <View style={styles.skeletonLines}>
              <View
                style={[styles.line, { backgroundColor: muted, width: "66%" }]}
              />
              <View
                style={[
                  styles.line,
                  { backgroundColor: muted, opacity: 0.7, width: "100%" },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    );
  }
  const Icon = coverageComplete ? MessageCircle : Search;
  return (
    <View style={[styles.centered, styles.emptyPadding]}>
      <Icon color={theme.dividerText} size={24} />
      <Text style={[styles.centeredText, { color: theme.dividerText }]}>
        {coverageComplete
          ? `No messages match “${query.trim()}”.`
          : "No matches are indexed yet. Try again after more history has been indexed."}
      </Text>
    </View>
  );
}

function ProfilesSection({
  creatingProfileId,
  onProfileRetry,
  onProfileSelect,
  onProfileToggleExpanded,
  onSkipToMessages,
  profileError,
  profileExpanded,
  profileLoading,
  profileRetryAt,
  profiles,
  query,
}: GlobalMessageSearchResultsProps & { onSkipToMessages: () => void }) {
  const { isDark, theme } = useAppTheme();
  const chip = chip3d(isDark);
  const foreground = isDark ? "#eeeeee" : "#202020";
  const muted = isDark ? "#262626" : "#e5e5e5";
  const ranked = useMemo(
    () => rankProfileSearchResults(profiles, query),
    [profiles, query]
  );
  const visible = visibleProfileResults(ranked, profileExpanded);
  const remaining = Math.max(0, profiles.length - PROFILE_PREVIEW_LIMIT);

  let body: ReactElement;
  if (profileLoading) {
    body = (
      <View accessibilityLabel="Searching profiles">
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.profileSkeleton}>
            <View style={[styles.avatarSkeleton, { backgroundColor: muted }]} />
            <View style={styles.skeletonLines}>
              <View
                style={[styles.line, { backgroundColor: muted, width: "40%" }]}
              />
              <View
                style={[
                  styles.line,
                  { backgroundColor: muted, opacity: 0.7, width: "25%" },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (profileError) {
    body = (
      <View style={styles.inlineError}>
        <Text
          style={[styles.note, styles.flexNote, { color: theme.dividerText }]}
        >
          {profileError}
        </Text>
        <SearchRetryButton onRetry={onProfileRetry} retryAt={profileRetryAt} />
      </View>
    );
  } else if (profiles.length === 0) {
    body = (
      <Text style={[styles.note, { color: theme.dividerText }]}>
        No matching profiles.
      </Text>
    );
  } else {
    body = (
      <View>
        {visible.map((profile) => {
          const disabled = creatingProfileId !== null || !profile.hasIdentity;
          return (
            <View key={profile.id} style={{ opacity: disabled ? 0.6 : 1 }}>
              <PressableRow
                onPress={disabled ? undefined : () => onProfileSelect(profile)}
                style={styles.profileRow}
              >
                <UserAvatar
                  size={36}
                  url={profile.avatarUrl}
                  userId={profile.id}
                  username={profile.username}
                />
                <View style={styles.flex}>
                  <Text
                    accessibilityLabel={`Message ${profile.displayName}`}
                    numberOfLines={1}
                    style={[styles.profileName, { color: foreground }]}
                  >
                    {profile.displayName}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.profileHandle, { color: theme.dividerText }]}
                  >
                    @{profile.username}
                  </Text>
                </View>
                {profile.hasIdentity ? null : (
                  <View
                    style={[
                      styles.chip,
                      {
                        backgroundColor: chip.background,
                        boxShadow: chip.shadows,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: foreground }]}>
                      Not on Messages
                    </Text>
                  </View>
                )}
                {creatingProfileId === profile.id ? (
                  <ZephLoader size={16} variant="search" />
                ) : null}
              </PressableRow>
            </View>
          );
        })}
        {remaining > 0 ? (
          <PressableRow
            onPress={onProfileToggleExpanded}
            style={styles.expandRow}
          >
            {profileExpanded ? (
              <ChevronUp color={theme.dividerText} size={16} />
            ) : (
              <ChevronDown color={theme.dividerText} size={16} />
            )}
            <Text style={[styles.expandText, { color: theme.dividerText }]}>
              {profileExpanded
                ? "Show fewer profiles"
                : `Show ${remaining} more profiles`}
            </Text>
          </PressableRow>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.profilesHeading}>
        <View>
          <Text style={[styles.headingText, { color: foreground }]}>
            Profiles
          </Text>
          <Text style={[styles.subheading, { color: theme.dividerText }]}>
            People you follow
          </Text>
        </View>
        {!profileLoading && profiles.length >= PROFILE_PREVIEW_LIMIT ? (
          <PressableRow onPress={onSkipToMessages} style={styles.skip}>
            <Text
              accessibilityLabel="Skip profiles and go to message results"
              style={[styles.expandText, { color: theme.dividerText }]}
            >
              Messages
            </Text>
            <ArrowDown color={theme.dividerText} size={14} />
          </PressableRow>
        ) : null}
      </View>
      {body}
    </View>
  );
}

function MessageResultRow({
  focused,
  myUserId,
  onSelect,
  result,
}: {
  focused: boolean;
  myUserId: string;
  onSelect: (result: GlobalMessageSearchResult) => void;
  result: GlobalMessageSearchResult;
}) {
  const { isDark, theme } = useAppTheme();
  const foreground = isDark ? "#eeeeee" : "#202020";
  const avatar = globalSearchConversationAvatar(result.hit);
  return (
    <View
      accessibilityLabel={globalSearchResultLabel(result, myUserId)}
      style={[
        styles.resultWrap,
        focused && {
          backgroundColor: PRIMARY_10,
          borderColor: PRIMARY_25,
          borderWidth: 1,
        },
        result.previewFailed && { opacity: 0.8 },
      ]}
    >
      <PressableRow onPress={() => onSelect(result)} style={styles.resultRow}>
        <UserAvatar
          size={36}
          url={
            avatar && result.hit.conversationType === "DEN"
              ? mediaUrl(avatar)
              : avatar
          }
          userId={result.hit.conversationId}
        />
        <View style={styles.flex}>
          <View style={styles.resultTop}>
            <Text
              numberOfLines={1}
              style={[styles.resultTitle, { color: foreground }]}
            >
              {globalSearchConversationTitle(result.hit)}
            </Text>
            <Text style={[styles.resultTime, { color: theme.dividerText }]}>
              {formatListTimestamp(result.hit.createdAt)}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[styles.resultSender, { color: theme.dividerText }]}
          >
            {globalSearchSenderLine(result.hit, myUserId)}
          </Text>
          <SearchPreview result={result} />
        </View>
      </PressableRow>
    </View>
  );
}

function SearchPreview({ result }: { result: GlobalMessageSearchResult }) {
  const { isDark, theme } = useAppTheme();
  const foreground = isDark ? "#eeeeee" : "#202020";
  if (result.preview) {
    return (
      <Text numberOfLines={2} style={[styles.preview, { color: foreground }]}>
        {highlightSnippetParts(result.preview).map((part, index) =>
          part.highlighted ? (
            <Text
              key={`${index}:${part.text}`}
              style={{ backgroundColor: PRIMARY_20, color: foreground }}
            >
              {part.text}
            </Text>
          ) : (
            part.text
          )
        )}
      </Text>
    );
  }
  if (result.previewFailed) {
    return (
      <Text style={[styles.preview, { color: theme.dividerText }]}>
        Preview unavailable · open message
      </Text>
    );
  }
  return (
    <View style={styles.decrypting}>
      <ZephLoader size={12} variant="search" />
      <Text style={[styles.preview, { color: theme.dividerText }]}>
        Decrypting preview…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarSkeleton: { borderRadius: 12, height: 40, width: 40 },
  centered: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 36,
  },
  centeredText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 19,
    maxWidth: 240,
    textAlign: "center",
  },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: "SofiaProReg", fontSize: 10 },
  // `px-1 pt-1 pb-4`.
  content: { paddingBottom: 16, paddingHorizontal: 4, paddingTop: 4 },
  coverage: {
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  decrypting: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  emptyPadding: { paddingVertical: 40 },
  expandRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  expandText: { fontFamily: "SofiaProMed", fontSize: 12 },
  flex: { flex: 1, minWidth: 0 },
  flexNote: { flex: 1 },
  headingText: { fontFamily: "SofiaProBold", fontSize: 14 },
  inlineError: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 12,
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  line: { borderRadius: 4, height: 12 },
  loadMore: { marginTop: 8 },
  messageSkeleton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 8,
  },
  // `mt-3 border-t pt-3`.
  messagesSection: { borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  note: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  preview: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  profileHandle: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 20 },
  profileName: { fontFamily: "SofiaProMed", fontSize: 14, lineHeight: 20 },
  profileRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  profileSkeleton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  profilesHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  refresh: {
    color: PRIMARY,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  resultRow: {
    alignItems: "flex-start",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    minHeight: 80,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  resultSender: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: 2 },
  resultTime: {
    fontFamily: "SofiaProReg",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  resultTitle: { flex: 1, fontFamily: "SofiaProBold", fontSize: 13 },
  resultTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  resultWrap: { borderRadius: 12, marginBottom: 4 },
  sectionHeading: {
    justifyContent: "center",
    marginBottom: 8,
    minHeight: 32,
    paddingHorizontal: 8,
  },
  skeletonLines: { flex: 1, gap: 8 },
  skeletons: { gap: 8, padding: 4 },
  skip: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  subheading: { fontFamily: "SofiaProReg", fontSize: 11, lineHeight: 20 },
});
