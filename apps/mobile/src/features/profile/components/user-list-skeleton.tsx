import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useAppTheme } from "@/theme";

export function UserListSkeleton() {
  const { theme } = useAppTheme();
  const opacity = useSkeletonPulse();
  return (
    <View accessibilityLabel="Loading people">
      {Array.from({ length: 7 }, (_, index) => (
        <Animated.View
          key={index}
          style={[styles.row, { borderBottomColor: theme.cardBorder, opacity }]}
        >
          <View
            style={[styles.avatar, { backgroundColor: theme.dividerLine }]}
          />
          <View style={styles.copy}>
            <View
              style={[
                styles.line,
                { backgroundColor: theme.dividerLine, width: "65%" },
              ]}
            />
            <View
              style={[
                styles.line,
                { backgroundColor: theme.dividerLine, width: "45%" },
              ]}
            />
          </View>
          <View
            style={[styles.button, { backgroundColor: theme.dividerLine }]}
          />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { borderRadius: 13, height: 44, width: 44 },
  button: { borderRadius: 20, height: 32, width: 80 },
  copy: { flex: 1, gap: 8 },
  line: { borderRadius: 4, height: 12 },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
});
