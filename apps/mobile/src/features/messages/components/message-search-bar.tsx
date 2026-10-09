import {
  ChevronLeft,
  ChevronRight,
  History,
  List,
  MessageSquare,
  Search,
  X,
} from "lucide-react-native";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";

import type { SearchPage } from "@/features/messages/lib/message-search";
import { MIN_SEARCH_QUERY_LENGTH } from "@/features/messages/lib/message-search";
import {
  searchChatStatus,
  searchListStatus,
  searchCoverageLabel,
} from "@/features/messages/lib/message-search-status";
import { useAppTheme } from "@/theme";

import { MessagesIconButton } from "./messages-primitives";

const ENTER = FadeIn.duration(150).reduceMotion(ReduceMotion.System);
const EXIT = FadeOut.duration(100).reduceMotion(ReduceMotion.System);

export function MessageSearchBar({
  query,
  onQueryChange,
  listView,
  onToggleView,
  onClose,
  onStep,
  onPage,
  onIndexOlder,
  indexingOlder,
  indexedCount,
  fullyCovered,
  canIndexOlder,
  error,
  matchCount,
  activePosition,
  page,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  listView: boolean;
  onToggleView: () => void;
  onClose: () => void;
  onStep: (direction: 1 | -1) => void;
  onPage: (direction: 1 | -1) => void;
  onIndexOlder: () => void;
  indexingOlder: boolean;
  indexedCount: number;
  fullyCovered: boolean;
  canIndexOlder: boolean;
  error: string | null;
  matchCount: number;
  activePosition: number;
  page: SearchPage;
}) {
  const { isDark, theme } = useAppTheme();
  const statusInput = {
    fullyCovered,
    indexingOlder,
    queryReady: query.trim().length >= MIN_SEARCH_QUERY_LENGTH,
  };
  const status =
    error ??
    (listView
      ? searchListStatus({
          ...statusInput,
          listPageStale: false,
          rangeEnd: page.rangeEnd,
          rangeStart: page.rangeStart,
          resultCount: page.pageResults.length,
          totalResults: matchCount,
        })
      : searchChatStatus({ ...statusInput, activePosition, matchCount }));
  const coverage = searchCoverageLabel({
    indexFailed: Boolean(error),
    indexedCount,
    indexingOlder,
  });
  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      className="flex-row items-center gap-2 border-b px-3"
      style={{ borderColor: theme.dividerLine, minHeight: 48 }}
    >
      <Search color={theme.dividerText} size={16} />
      <TextInput
        accessibilityLabel="Search messages in this conversation"
        autoFocus
        className="min-w-0 flex-1 bg-transparent"
        style={{
          color: isDark ? "#eeeeee" : "#202020",
          fontFamily: "SofiaProReg",
          fontSize: 14,
          paddingVertical: 8,
        }}
        placeholder="Search messages"
        placeholderTextColor={theme.dividerText}
        onChangeText={onQueryChange}
        onSubmitEditing={() => onStep(1)}
        returnKeyType="search"
        value={query}
      />
      <View style={{ maxWidth: 90 }}>
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={2}
          style={{
            color: theme.dividerText,
            fontFamily: "SofiaProReg",
            fontSize: 12,
            textAlign: "right",
          }}
        >
          {status}
        </Text>
      </View>
      <MessagesIconButton
        disabled={listView ? page.page === 0 : matchCount === 0}
        icon={ChevronLeft}
        label={listView ? "Previous page of results" : "Previous match"}
        onPress={() => (listView ? onPage(-1) : onStep(-1))}
        size={28}
      />
      {listView ? (
        <Text style={{ color: theme.dividerText, fontSize: 12 }}>
          {page.page + 1}/{page.pageCount}
        </Text>
      ) : null}
      <MessagesIconButton
        disabled={listView ? page.page >= page.pageCount - 1 : matchCount === 0}
        icon={ChevronRight}
        label={listView ? "Next page of results" : "Next match"}
        onPress={() => (listView ? onPage(1) : onStep(1))}
        size={28}
      />
      {indexingOlder ? (
        <ActivityIndicator
          accessibilityLabel={coverage}
          color={theme.dividerText}
          size="small"
        />
      ) : null}
      {!indexingOlder && canIndexOlder ? (
        <MessagesIconButton
          icon={History}
          label={coverage}
          onPress={onIndexOlder}
          size={28}
        />
      ) : null}
      <MessagesIconButton
        icon={listView ? MessageSquare : List}
        label={listView ? "Show results in chat" : "Show results as a list"}
        onPress={onToggleView}
        size={28}
      />
      <MessagesIconButton
        icon={X}
        label="Close search"
        onPress={onClose}
        size={28}
      />
    </Animated.View>
  );
}
