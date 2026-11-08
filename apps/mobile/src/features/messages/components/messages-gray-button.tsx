// `.btn-3d-gray` for the messages UI: the neutral raised pill behind "Try
// again", "Load older results" and "Open community chat". Drawn with Gradient3D
// so the inset lip survives on top of the gradient.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { btnGray } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

export function MessagesGrayButton({
  accessibilityLabel,
  children,
  disabled = false,
  label,
  onPress,
  style,
}: {
  accessibilityLabel?: string;
  children?: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useAppTheme();
  const recipe = btnGray(isDark);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[{ opacity: disabled ? 0.6 : 1 }, style]}
    >
      {({ pressed }) => {
        const state = pressed ? recipe.pressed : recipe.resting;
        return (
          <Gradient3D
            colors={state.colors}
            radius={12}
            shadows={state.shadows}
            style={styles.surface}
          >
            {children}
            <Text style={[styles.label, { color: state.text }]}>{label}</Text>
          </Gradient3D>
        );
      }}
    </Pressable>
  );
}

// Web's SearchRetryButton: disabled with a live countdown until the server's
// Retry-After deadline passes.
export function SearchRetryButton({
  onRetry,
  retryAt = 0,
}: {
  onRetry: () => void;
  retryAt?: number;
}) {
  const [now, setNow] = useState(Date.now);
  const remainingSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    if (remainingSeconds === 0) {
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [remainingSeconds]);
  return (
    <MessagesGrayButton
      disabled={remainingSeconds > 0}
      label={
        remainingSeconds > 0 ? `Try again in ${remainingSeconds}s` : "Try again"
      }
      onPress={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  // `min-h-11 rounded-xl px-3 text-xs font-medium`.
  label: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  surface: {
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
  },
});
