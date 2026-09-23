// Web's `.rail-3d-btn`: the glass round button the reel floats over video
// (h-11 w-11 on the rail, h-10 w-10 in the page chrome), plus its orange /
// purple / gold active recipes. Press scales to 0.95 like web's whileTap.
// The active surface is a fresh Gradient3D mount, never a shadow swapped
// onto the resting view (Android draws a late shadow square).
import type { ReactNode } from "react";
import { useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { RAIL_ACTIVE, RAIL_BUTTON } from "@/components/surface/recipes";

export type RailTone = keyof typeof RAIL_ACTIVE;

export function RailButton({
  accessibilityLabel,
  active = false,
  children,
  disabled = false,
  onPress,
  size = 44,
  style,
  tone = "orange",
}: {
  accessibilityLabel: string;
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
  tone?: RailTone;
}) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [scale] = useState(() => new Animated.Value(1));
  const pressTo = (toValue: number) => {
    Animated.timing(scale, {
      duration: 120,
      easing: Easing.out(Easing.quad),
      toValue,
      useNativeDriver: true,
    }).start();
  };
  const recipe = RAIL_ACTIVE[tone];
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      onPressIn={() => pressTo(0.95)}
      onPressOut={() => pressTo(1)}
      style={style}
    >
      <Animated.View
        style={[
          styles.button,
          {
            height: size,
            transform: [{ scale }],
            width: size,
          },
          disabled && styles.disabled,
        ]}
      >
        {active ? (
          <Gradient3D
            colors={recipe.colors}
            shadows={recipe.shadows}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.glass} />
        )}
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  glass: {
    backgroundColor: RAIL_BUTTON.background,
    borderRadius: 9999,
    bottom: 0,
    boxShadow: RAIL_BUTTON.shadows,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});

export const RAIL_ICON_COLOR = RAIL_BUTTON.color;
