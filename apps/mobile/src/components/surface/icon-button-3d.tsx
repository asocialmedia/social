// Web's `.icon-btn-3d` round button (optionally `.icon-btn-3d-danger`):
// the recessed resting chip, and the hover recipe shown while pressed. The
// pressed layer is a freshly mounted Gradient3D (a shadow added to an
// existing view draws square on Android).
import type { ComponentType } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

import { Gradient3D } from "./gradient-3d";
import { iconButton, pressedDanger, pressedPill } from "./recipes";

export function IconButton3D({
  accessibilityLabel,
  danger = false,
  icon: Icon,
  iconSize = 16,
  onPress,
  size = 32,
}: {
  accessibilityLabel: string;
  danger?: boolean;
  icon: ComponentType<{ color?: string; size?: number }>;
  iconSize?: number;
  onPress: () => void;
  size?: number;
}) {
  const { isDark } = useAppTheme();
  const resting = iconButton(isDark);
  const pressedTone = danger ? pressedDanger(isDark) : pressedPill(isDark);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.base,
            {
              backgroundColor: resting.background,
              boxShadow: resting.shadows,
              height: size,
              width: size,
            },
            pressed && styles.pressed,
          ]}
        >
          {pressed ? (
            <Gradient3D
              colors={pressedTone.gradient}
              shadows={pressedTone.shadows}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Icon
            color={pressed ? pressedTone.color : resting.color}
            size={iconSize}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
