import { StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

const states = {
  idle: { color: "#f59e0b", label: "Idle" },
  offline: { color: "#8e8e93", label: "Offline" },
  online: { color: "#22c55e", label: "Online" },
} as const;

export function MessagePresenceIndicator({
  status,
  testID,
}: {
  status: keyof typeof states | null;
  testID: string;
}) {
  const { theme } = useAppTheme();
  const state = states[status ?? "offline"];
  return (
    <View
      accessible
      accessibilityLabel={state.label}
      pointerEvents="none"
      testID={testID}
      style={[
        styles.dot,
        { backgroundColor: state.color, borderColor: theme.containerBg },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 6,
    borderWidth: 2,
    bottom: -2,
    height: 12,
    position: "absolute",
    right: -2,
    width: 12,
  },
});
