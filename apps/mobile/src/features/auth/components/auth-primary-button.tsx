// Shared 3D primary button (btn-3d / premium), the native build of web's
// `variant="premium"` Button. It rides a Gradient3D rather than a View
// wrapping a LinearGradient: React Native paints inset shadows on the view's
// own background, so a gradient child hides the bright inner lip and the
// recipe's dual border collapses to a single ring. Used by login, signup,
// reset-password, confirm-reset and help.

import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_DISABLED_GRADIENT,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";
import {
  LOGIN_BUTTON_DISABLED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

interface AuthPrimaryButtonProps {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
}

// Web's `.btn-3d` states: resting, `:active` and `:disabled`. The base stack is
// the dark recipe and light mode has its own override, so each state resolves
// its shadow here rather than in a nested ternary inside the render prop.
function btn3dTone(isDark: boolean, isDisabled: boolean, pressed: boolean) {
  if (isDisabled) {
    return {
      colors: ORANGE_DISABLED_GRADIENT,
      shadows: LOGIN_BUTTON_DISABLED_SHADOWS,
    };
  }
  if (pressed) {
    return {
      colors: ORANGE_PRESSED_GRADIENT,
      shadows: isDark
        ? LOGIN_BUTTON_PRESSED_SHADOWS
        : LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
    };
  }
  return {
    colors: ORANGE_GRADIENT,
    shadows: isDark ? LOGIN_BUTTON_SHADOWS : LOGIN_BUTTON_SHADOWS_LIGHT,
  };
}

export function AuthPrimaryButton({
  disabled,
  label,
  loading,
  onPress,
}: AuthPrimaryButtonProps) {
  const { isDark } = useAppTheme();
  // `disabled ?? loading` let an explicit `disabled={false}` re-enable the
  // button mid-request, since only an absent prop fell through to `loading`.
  const isDisabled = disabled === true || loading === true;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={styles.fullWidth}
    >
      {({ pressed }) => {
        const tone = btn3dTone(isDark, isDisabled, pressed);
        return (
          <Gradient3D
            colors={tone.colors}
            radius={9999}
            shadows={tone.shadows}
            style={[styles.btn, pressed && !isDisabled && styles.pressed]}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : null}
            <Text
              className="text-base tracking-tight text-white"
              style={[styles.label, isDisabled && styles.labelDisabled]}
            >
              {label}
            </Text>
          </Gradient3D>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    gap: 8,
    height: 44,
    paddingHorizontal: 16,
  },
  fullWidth: {
    width: "100%",
  },
  label: {
    fontFamily: "SofiaProBold",
    fontWeight: "normal",
    letterSpacing: -0.3,
    ...({ textShadow: "0 1px 1px rgba(0, 0, 0, 0.2)" } as Record<
      string,
      string
    >),
  },
  // `.btn-3d:disabled` drops the label's shadow along with the saturated fill.
  labelDisabled: {
    ...({ textShadow: "none" } as Record<string, string>),
  },
  // `.btn-3d:active` sinks the pill 1px; the darker gradient above does the
  // rest, so there is no opacity step.
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
