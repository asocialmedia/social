import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useAppTheme } from "@/theme";

export function ConversationListSkeleton() {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View
      accessibilityLabel="Loading conversations"
      style={[styles.list, { opacity: pulse }]}
    >
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <View key={index} style={styles.row}>
          <View style={[styles.avatar, block]} />
          <View style={styles.body}>
            <View style={styles.lineRow}>
              <View
                style={[
                  styles.line,
                  block,
                  { width: index % 2 ? "50%" : "40%" },
                ]}
              />
              <View style={[styles.time, block]} />
            </View>
            <View style={styles.lineRow}>
              <View
                style={[
                  styles.line,
                  block,
                  { width: index % 2 ? "75%" : "60%" },
                ]}
              />
              {index % 3 === 0 ? <View style={[styles.unread, block]} /> : null}
            </View>
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

export function ThreadSkeleton() {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View
      accessibilityLabel="Loading conversation"
      style={[styles.thread, { opacity: pulse }]}
    >
      <View style={[styles.date, block]} />
      {[0, 1, 2, 3, 4].map((index) => (
        <View
          key={index}
          style={[styles.bubbleRow, index % 2 ? styles.mine : undefined]}
        >
          <View
            style={[styles.bubbleBody, { width: index % 2 ? "52%" : "72%" }]}
          >
            <View
              style={[
                styles.bubble,
                block,
                {
                  borderBottomLeftRadius: index % 2 ? 16 : 5,
                  borderBottomRightRadius: index % 2 ? 5 : 16,
                  height: index === 2 ? 80 : 44,
                },
              ]}
            />
            <View
              style={[styles.time, block, index % 2 ? styles.mine : undefined]}
            />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  avatar: { borderRadius: 12, height: 40, width: 40 },
  body: { flex: 1, gap: 8, minWidth: 0 },
  bubble: { borderRadius: 16, width: "100%" },
  bubbleBody: { gap: 5, maxWidth: "78%" },
  bubbleRow: { alignSelf: "flex-start", width: "100%" },
  date: {
    alignSelf: "center",
    borderRadius: 999,
    height: 20,
    marginBottom: 12,
    width: 64,
  },
  line: { borderRadius: 4, height: 12 },
  lineRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  list: { gap: 22, paddingHorizontal: 18, paddingVertical: 12 },
  mine: { alignItems: "flex-end", alignSelf: "flex-end" },
  row: { alignItems: "center", flexDirection: "row", gap: 12 },
  thread: {
    flex: 1,
    gap: 12,
    justifyContent: "flex-end",
    overflow: "hidden",
    padding: 16,
  },
  time: { borderRadius: 4, height: 8, width: 30 },
  unread: { borderRadius: 999, height: 16, width: 16 },
});
