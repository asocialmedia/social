// 1:1 native port of web GuestAuthBar
// (components/layouts/shell/guest-auth-bar.tsx). Orange gradient bar shown
// to guests: "Log in to start posting on asocialmedia" + white Log in pill
// and Sign up buttons. UI-only: no scroll-hiding, no routing guards.

import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SOCIAL_PRESSED_SHADOWS, SOCIAL_SHADOWS } from "@/theme";

export function GuestAuthBar() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.docked, { paddingBottom: insets.bottom }]}>
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
                  styles.loginBtn,
                  {
                    boxShadow: pressed
                      ? SOCIAL_PRESSED_SHADOWS
                      : SOCIAL_SHADOWS,
                  },
                  pressed && styles.pressedShift,
                ]}
              >
                <Text style={styles.loginBtnText}>Log in</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/signup")}>
            {({ pressed }) => (
              <View
                style={[
                  styles.signupBtn,
                  {
                    boxShadow: pressed
                      ? SOCIAL_PRESSED_SHADOWS
                      : SOCIAL_SHADOWS,
                  },
                  pressed && styles.pressedShift,
                ]}
              >
                <Text style={styles.signupBtnText}>Sign up</Text>
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
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  docked: {
    // inset 0 0 0 1px rgba(255,255,255,.25), inner lip, and drop shadow
    // mirror the web .btn-3d bevel on the banner.
    shadowColor: "#000000",
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  loginBtn: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loginBtnText: {
    color: "#e65500",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  signupBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 20,
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
  },
  title: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
});
