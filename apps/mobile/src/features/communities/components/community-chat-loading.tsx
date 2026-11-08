// Native port of web's CommunityChatLoading
// (apps/web/src/components/communities/page/community-chat-loading.tsx).
// Same skeleton: a header row, three message rows (avatar + name + body
// lines), and the composer bar. Static low-opacity blocks (no looping
// animation) so the first paint stays cheap on the JS thread.
import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

function SkeletonBlock({
  height,
  radius,
  width,
}: {
  height: number;
  radius: number;
  width: number | string;
}) {
  const { isDark } = useAppTheme();
  return (
    <View
      style={[
        styles.block,
        {
          backgroundColor: isDark ? "#262626" : "#e4e4e7",
          borderRadius: radius,
          height,
          width,
        },
      ]}
    />
  );
}

function CommunityChatLoading() {
  const { theme } = useAppTheme();
  return (
    <View
      accessibilityLabel="Loading community chat"
      accessibilityRole="progressbar"
      style={[styles.root, { backgroundColor: theme.containerBg }]}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[styles.header, { borderBottomColor: theme.cardBorder }]}
      >
        <SkeletonBlock height={40} radius={12} width={40} />
        <SkeletonBlock height={20} radius={6} width={160} />
      </View>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={styles.body}
      >
        {["first", "second", "third"].map((key) => (
          <View key={key} style={styles.row}>
            <SkeletonBlock height={36} radius={18} width={36} />
            <View style={styles.lines}>
              <SkeletonBlock height={12} radius={4} width={96} />
              <SkeletonBlock height={16} radius={4} width="100%" />
              <SkeletonBlock height={16} radius={4} width="66%" />
            </View>
          </View>
        ))}
        <SkeletonBlock height={56} radius={16} width="100%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { opacity: 0.85 },
  body: {
    flex: 1,
    gap: 24,
    justifyContent: "flex-end",
    padding: 16,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  lines: { flex: 1, gap: 8 },
  root: { flex: 1 },
  row: { flexDirection: "row", gap: 12 },
});

export default memo(CommunityChatLoading);
