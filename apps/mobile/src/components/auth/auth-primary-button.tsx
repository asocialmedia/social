// Shared 3D primary button (btn-3d / premium). Same construction as the
// Log in button on LoginScreen: orange gradient, inner lip + drop shadows,
// pressed shift. Used by signup, reset-password, confirm-reset, help.

import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { LOGIN_BUTTON_PRESSED_SHADOWS, LOGIN_BUTTON_SHADOWS } from "@/theme";

interface AuthPrimaryButtonProps {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
}

export function AuthPrimaryButton({
  disabled,
  label,
  loading,
  onPress,
}: AuthPrimaryButtonProps) {
  return (
    <Pressable
      disabled={disabled ?? loading}
      onPress={onPress}
      style={styles.fullWidth}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.btn,
            {
              boxShadow: pressed
                ? LOGIN_BUTTON_PRESSED_SHADOWS
                : LOGIN_BUTTON_SHADOWS,
            },
            pressed && styles.pressedShift,
          ]}
        >
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.gradient}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : null}
            <Text
              className="text-base tracking-tight text-white"
              style={styles.label}
            >
              {label}
            </Text>
          </LinearGradient>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 9999,
  },
  fullWidth: {
    width: "100%",
  },
  gradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 8,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  label: {
    fontFamily: "SofiaProBold",
    fontWeight: "normal",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
});
