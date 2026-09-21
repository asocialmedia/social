// 1:1 native port of web GuestAuthBar
// (components/layouts/shell/guest-auth-bar.tsx), mobile arrangement:
// centered copy stacked above the Log in / Sign up row, orange horizontal
// gradient, top border + inner bevel, white-gradient Log in pill and gray
// 3D Sign up pill. UI-only: no scroll-hiding, no routing guards.

import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BANNER_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.4), 0 -2px 8px rgba(0, 0, 0, 0.18)";

const WHITE_PILL_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.9), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.5), 0 1px 1px rgba(0, 0, 0, 0.18), 0 2px 5px rgba(0, 0, 0, 0.18)";

const GRAY_3D_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1.5px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.2)";

const GRAY_3D_PRESSED_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.12)";

export function GuestAuthBar() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.docked,
        {
          borderTopColor: "rgba(255, 149, 0, 0.25)",
          boxShadow: BANNER_SHADOWS,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <LinearGradient
        colors={["#ff9500", "#e65500"]}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.banner}
      >
        <View style={styles.copy}>
          <Text style={styles.title}>
            Log in to start posting on asocialmedia
          </Text>
          <Text style={styles.subtitle}>
            Sign in with an account to start posting on asocialmedia
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => router.push("/(auth)/login")}>
            {({ pressed }) => (
              <View
                style={[
                  styles.pill,
                  { boxShadow: WHITE_PILL_SHADOWS },
                  pressed && styles.pressedShift,
                ]}
              >
                <LinearGradient
                  colors={["#ffffff", "#ececec"]}
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={styles.pillGradient}
                >
                  <Text style={styles.loginBtnText}>Log in</Text>
                </LinearGradient>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/signup")}>
            {({ pressed }) => (
              <View
                style={[
                  styles.pill,
                  {
                    boxShadow: pressed
                      ? GRAY_3D_PRESSED_SHADOWS
                      : GRAY_3D_SHADOWS,
                  },
                  pressed && styles.pressedShift,
                ]}
              >
                <LinearGradient
                  colors={["#4a4a4a", "#333333"]}
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={styles.pillGradient}
                >
                  <Text style={styles.signupBtnText}>Sign up</Text>
                </LinearGradient>
              </View>
            )}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 8,
  },
  banner: {
    alignItems: "center",
    flexDirection: "column",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  copy: {
    alignItems: "center",
    width: "100%",
  },
  docked: {
    borderTopWidth: 1,
  },
  loginBtnText: {
    color: "#e65500",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  pill: {
    borderRadius: 9999,
  },
  pillGradient: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  signupBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.85)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
  title: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
});
