// 1:1 native port of web GuestAuthBar
// (components/layouts/shell/guest-auth-bar.tsx), mobile arrangement:
// centered copy stacked above the Log in / Sign up row, orange horizontal
// gradient, top border + inner bevel, white-gradient Log in pill and gray
// 3D Sign up pill. UI-only: no scroll-hiding, no routing guards. The parent
// screen floats the bar over the feed above the bottom dock.
//
// No safe-area padding here, unlike web's pb-safe. Web applies that only
// when it has no nav to dock onto (!hasNav && pb-safe); every native call
// site renders this above an always-present MobileBottomNav and already
// clears the inset in its own bottom offset (dockHeight + insets.bottom +
// gap). Adding the inset again as padding stacked a second copy of it
// under the buttons, so the bar read taller at the bottom than the top.
// paddingVertical is symmetric and is the only vertical spacing.
//
// Every surface here is a Gradient3D, not a View wrapping a LinearGradient.
// On web the gradient, the border and the box-shadow sit on one element, so
// the inset layers paint over the gradient and the inner lip survives. React
// Native paints inset shadows on the view's own background, so a gradient
// child covers them and the dual border collapses to a single outer ring -
// which is what this bar was showing. Gradient3D splits the recipe so the
// lip lands where web puts it.

import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { ORANGE_GRADIENT } from "@/components/surface/recipes";

const BANNER_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.4), 0 -2px 8px rgba(0, 0, 0, 0.18)";

const WHITE_PILL_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.9), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.5), 0 1px 1px rgba(0, 0, 0, 0.18), 0 2px 5px rgba(0, 0, 0, 0.18)";

const GRAY_3D_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1.5px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.2)";

const GRAY_3D_PRESSED_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.12)";

// Web's border-t is border-[hsl(var(--primary)/0.25)], and --primary is
// 22.93 92.59% 52.35% - that is #f66b15, not the #ff9500 the gradient
// happens to start from. Reusing the gradient's orange here drew a warmer
// hairline than the web bar does.
const BANNER_BORDER = "rgba(246, 107, 21, 0.25)";

const LOGIN_PILL_GRADIENT = ["#ffffff", "#ececec"] as const;
const SIGNUP_PILL_GRADIENT = ["#4a4a4a", "#333333"] as const;

export function GuestAuthBar() {
  const router = useRouter();

  return (
    <View style={[styles.docked, { borderTopColor: BANNER_BORDER }]}>
      <Gradient3D
        colors={ORANGE_GRADIENT}
        direction="horizontal"
        radius={0}
        shadows={BANNER_SHADOWS}
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
              <Gradient3D
                colors={LOGIN_PILL_GRADIENT}
                shadows={WHITE_PILL_SHADOWS}
                style={[styles.pill, pressed && styles.pressedShift]}
              >
                <Text style={styles.loginBtnText}>Log in</Text>
              </Gradient3D>
            )}
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/signup")}>
            {({ pressed }) => (
              <Gradient3D
                colors={SIGNUP_PILL_GRADIENT}
                shadows={pressed ? GRAY_3D_PRESSED_SHADOWS : GRAY_3D_SHADOWS}
                style={[styles.pill, pressed && styles.pressedShift]}
              >
                <Text style={styles.signupBtnText}>Sign up</Text>
              </Gradient3D>
            )}
          </Pressable>
        </View>
      </Gradient3D>
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
  // Gradient3D owns the radius and centers its content, so the pill only
  // carries size now. The old wrapper's own borderRadius is gone: the
  // component applies it to the gradient and the inset overlay, which a
  // separate style could not reach.
  pill: {
    height: 36,
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
