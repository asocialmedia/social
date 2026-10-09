import { FlatList, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { UserAvatar } from "@/components/avatar/user-avatar";
import type { RankedSearchResult } from "@/features/messages/lib/message-search";
import type { MessageData } from "@/features/messages/lib/types";
import { useAppTheme } from "@/theme";

import { PressableRow } from "./messages-primitives";

export function MessageSearchResults({
  results,
  messages,
  activeId,
  userId,
  peerName,
  onJump,
  emptyLabel,
}: {
  results: RankedSearchResult[];
  messages: MessageData[];
  activeId: string | null;
  userId: string | null;
  peerName: string;
  onJump: (id: string) => void;
  emptyLabel: string;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(100)}
      className="absolute inset-0"
      style={{ backgroundColor: theme.containerBg }}
    >
      <FlatList
        data={results}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 8 }}
        ListEmptyComponent={
          <Text
            className="px-6 py-10 text-center"
            style={{
              color: theme.dividerText,
              fontFamily: "SofiaProReg",
              fontSize: 12,
            }}
          >
            {emptyLabel}
          </Text>
        }
        renderItem={({ item }) => {
          const message = messages.find((row) => row.id === item.id);
          const mine = message?.senderId === userId;
          let cursor = 0;
          const segments: React.ReactNode[] = [];
          for (const [index, range] of item.ranges.entries()) {
            segments.push(
              <Text key={`text-${index}`}>
                {item.snippet.text.slice(cursor, range.start)}
              </Text>,
              <Text
                key={`match-${index}`}
                style={{ backgroundColor: "#ff950040" }}
              >
                {item.snippet.text.slice(range.start, range.end)}
              </Text>
            );
            cursor = range.end;
          }
          segments.push(
            <Text key="tail">{item.snippet.text.slice(cursor)}</Text>
          );
          return (
            <View
              className="rounded-xl"
              style={{
                backgroundColor:
                  item.id === activeId ? "#ff95001a" : "transparent",
              }}
            >
              <PressableRow
                onPress={() => onJump(item.id)}
                style={{
                  alignItems: "flex-start",
                  flexDirection: "row",
                  gap: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <UserAvatar
                  size={32}
                  url={message?.sender?.avatarUrl ?? null}
                />
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text
                      numberOfLines={1}
                      style={{
                        color: isDark ? "#eeeeee" : "#202020",
                        fontFamily: "SofiaProBold",
                        fontSize: 12,
                      }}
                    >
                      {mine ? "You" : peerName}
                    </Text>
                    <Text
                      style={{
                        color: theme.dividerText,
                        fontFamily: "SofiaProReg",
                        fontSize: 11,
                      }}
                    >
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: theme.dividerText,
                      fontFamily: "SofiaProReg",
                      fontSize: 13,
                    }}
                  >
                    {item.snippet.offset > 0 ? "…" : ""}
                    {segments}
                    {item.snippet.offset + item.snippet.text.length <
                    item.text.length
                      ? "…"
                      : ""}
                  </Text>
                </View>
              </PressableRow>
            </View>
          );
        }}
      />
    </Animated.View>
  );
}
